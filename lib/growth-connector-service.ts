/**
 * The OAuth flow and data reads for §6's three connectors.
 *
 * Tokens are encrypted with the same `encryptSecret` every other credential in
 * this codebase uses, and never leave the server: nothing here returns a token
 * to the browser, and the status endpoint reports state, not secrets.
 *
 * Read failures are values, not exceptions. "Google returned 403 for that
 * property" is something a workspace can act on; a 500 on the growth board is
 * not. So every fetch returns `{ ok, observations, reason }` and the board
 * shows the reason next to the source.
 */

import { getRawDb } from '@/db/index';
import { platformProviderSecret } from '@/lib/provider-adapters';
import {
  createOpaqueToken,
  decryptSecret,
  encryptSecret,
  sha256,
} from '@/lib/security';
import type { Observation } from '@/lib/growth-manager';
import {
  analyticsObservations,
  authorizeUrl,
  connectorStatus,
  CONNECTOR_IDS,
  CONNECTORS,
  hubspotObservations,
  needsRefresh,
  searchObservations,
  type ConnectorId,
  type ConnectorStatus,
} from '@/lib/growth-connectors';

const WINDOW_DAYS = 28;

type StoredConnection = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  selection: string | null;
  lastSyncedAt: string | null;
};

/** The integration_connections row type for a connector. */
function rowType(id: ConnectorId) {
  return `growth_${id}`;
}

async function platformApp(id: ConnectorId) {
  const connector = CONNECTORS[id];
  const secret = await platformProviderSecret(connector.platformProvider);
  const config = secret.config as { clientId?: unknown; redirectUri?: unknown };
  const clientId = typeof config.clientId === 'string' ? config.clientId : '';
  const redirectUri =
    typeof config.redirectUri === 'string' ? config.redirectUri : '';
  return {
    clientId,
    clientSecret: secret.apiKey ?? '',
    redirectUri,
    ready: Boolean(clientId && secret.apiKey),
  };
}

async function loadConnection(
  organizationId: string,
  id: ConnectorId,
): Promise<StoredConnection | null> {
  const row = await getRawDb()
    .prepare(
      `SELECT encrypted_secret, public_config_json, last_checked_at FROM integration_connections
       WHERE organization_id = ? AND type = ? LIMIT 1`,
    )
    .bind(organizationId, rowType(id))
    .first<{
      encrypted_secret: string | null;
      public_config_json: string;
      last_checked_at: string | null;
    }>();
  if (!row?.encrypted_secret) return null;
  let bundle: { access?: string; refresh?: string } = {};
  try {
    bundle = JSON.parse(
      await decryptSecret(row.encrypted_secret),
    ) as typeof bundle;
  } catch {
    return null;
  }
  const config = safeObject(row.public_config_json);
  return {
    accessToken: bundle.access ?? '',
    refreshToken: bundle.refresh ?? null,
    expiresAt: typeof config.expiresAt === 'string' ? config.expiresAt : null,
    selection: typeof config.selection === 'string' ? config.selection : null,
    lastSyncedAt: row.last_checked_at,
  };
}

async function saveConnection(input: {
  organizationId: string;
  id: ConnectorId;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  selection: string | null;
}) {
  const encrypted = await encryptSecret(
    JSON.stringify({ access: input.accessToken, refresh: input.refreshToken }),
  );
  await getRawDb()
    .prepare(`INSERT INTO integration_connections
      (id, organization_id, type, name, status, public_config_json, encrypted_secret)
      VALUES (?, ?, ?, ?, 'connected', ?, ?)
      ON CONFLICT(organization_id, type) DO UPDATE SET
        status = 'connected', public_config_json = excluded.public_config_json,
        encrypted_secret = excluded.encrypted_secret`)
    .bind(
      `integration_${crypto.randomUUID()}`,
      input.organizationId,
      rowType(input.id),
      CONNECTORS[input.id].label,
      JSON.stringify({
        expiresAt: input.expiresAt,
        selection: input.selection,
      }),
      encrypted,
    )
    .run();
}

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

export async function connectorStatuses(
  organizationId: string,
): Promise<ConnectorStatus[]> {
  const statuses: ConnectorStatus[] = [];
  for (const id of CONNECTOR_IDS) {
    const [app, connection] = await Promise.all([
      platformApp(id),
      loadConnection(organizationId, id),
    ]);
    statuses.push(
      connectorStatus({
        connector: CONNECTORS[id],
        platformReady: app.ready,
        connection: connection
          ? {
              hasToken: Boolean(connection.accessToken),
              selection: connection.selection,
              expiresAt: connection.expiresAt,
              hasRefreshToken: Boolean(connection.refreshToken),
              lastSyncedAt: connection.lastSyncedAt,
            }
          : null,
      }),
    );
  }
  return statuses;
}

/* ------------------------------------------------------------------ *
 * Starting an authorisation
 * ------------------------------------------------------------------ */

export async function startConnection(input: {
  organizationId: string;
  id: ConnectorId;
}): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  const app = await platformApp(input.id);
  if (!app.ready)
    return {
      ok: false,
      reason: `Vaani has not registered a ${CONNECTORS[input.id].label} app yet. Your platform administrator sets that once.`,
    };
  if (!app.redirectUri)
    return {
      ok: false,
      reason: `The ${CONNECTORS[input.id].label} app has no redirect URL configured, so Google would refuse the request.`,
    };

  const state = createOpaqueToken('gconn_');
  const verifier = createOpaqueToken('pkce_');
  const challenge = base64Url(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  );
  await getRawDb()
    .prepare(`INSERT INTO oauth_states
      (id, provider, state_hash, code_verifier_encrypted, return_to, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(
      `oauth_state_${crypto.randomUUID()}`,
      `growth:${input.id}`,
      await sha256(state),
      await encryptSecret(verifier),
      // The workspace is carried in return_to because the callback arrives
      // from Google with no session of ours attached to it.
      `${input.organizationId}`,
      new Date(Date.now() + 10 * 60_000).toISOString(),
    )
    .run();

  return {
    ok: true,
    url: authorizeUrl({
      connector: CONNECTORS[input.id],
      clientId: app.clientId,
      redirectUri: app.redirectUri,
      state,
      codeChallenge: challenge,
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Completing one
 * ------------------------------------------------------------------ */

export async function completeConnection(input: {
  id: ConnectorId;
  code: string;
  state: string;
}): Promise<
  { ok: true; organizationId: string } | { ok: false; reason: string }
> {
  const db = getRawDb();
  const stateHash = await sha256(input.state);
  const row = await db
    .prepare(`SELECT id, code_verifier_encrypted, return_to FROM oauth_states
      WHERE state_hash = ? AND provider = ? AND consumed_at IS NULL AND expires_at > ? LIMIT 1`)
    .bind(stateHash, `growth:${input.id}`, new Date().toISOString())
    .first<{
      id: string;
      code_verifier_encrypted: string;
      return_to: string;
    }>();
  // A state that does not match, has been used, or has expired is refused
  // outright — this is the only thing standing between the callback and
  // anybody who can guess a URL.
  if (!row)
    return {
      ok: false,
      reason: 'That authorisation link is no longer valid. Start again.',
    };
  await db
    .prepare(
      'UPDATE oauth_states SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?',
    )
    .bind(row.id)
    .run();

  const app = await platformApp(input.id);
  if (!app.ready)
    return { ok: false, reason: 'The platform app is no longer configured.' };

  const body: Record<string, string> = {
    client_id: app.clientId,
    client_secret: app.clientSecret,
    redirect_uri: app.redirectUri,
    grant_type: 'authorization_code',
    code: input.code,
  };
  if (CONNECTORS[input.id].platformProvider === 'google_oauth')
    body.code_verifier = await decryptSecret(row.code_verifier_encrypted);

  const response = await fetch(CONNECTORS[input.id].tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!response.ok || !payload.access_token)
    return {
      ok: false,
      reason:
        payload.error_description ??
        payload.error ??
        'The provider refused the authorisation.',
    };

  await saveConnection({
    organizationId: row.return_to,
    id: input.id,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : null,
    // Deliberately null: authorised is not connected. Nothing is read until
    // somebody picks which property or site this is.
    selection: null,
  });
  return { ok: true, organizationId: row.return_to };
}

/** Renews an access token, or says why it could not. */
async function usableToken(
  organizationId: string,
  id: ConnectorId,
): Promise<{ token: string } | { reason: string }> {
  const connection = await loadConnection(organizationId, id);
  if (!connection?.accessToken) return { reason: 'not_connected' };
  if (!needsRefresh(connection.expiresAt))
    return { token: connection.accessToken };
  if (!connection.refreshToken)
    return {
      reason:
        'The authorisation has run out and there is no refresh token to renew it. Connect it again.',
    };

  const app = await platformApp(id);
  const response = await fetch(CONNECTORS[id].tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: connection.refreshToken,
    }).toString(),
  });
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token)
    return {
      reason:
        payload.error_description ??
        'The provider refused to renew the authorisation.',
    };
  await saveConnection({
    organizationId,
    id,
    accessToken: payload.access_token,
    refreshToken: connection.refreshToken,
    expiresAt: payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : null,
    selection: connection.selection,
  });
  return { token: payload.access_token };
}

/* ------------------------------------------------------------------ *
 * Choosing what to read
 * ------------------------------------------------------------------ */

export type Choice = { id: string; label: string };

export async function listChoices(input: {
  organizationId: string;
  id: ConnectorId;
}): Promise<{ ok: true; choices: Choice[] } | { ok: false; reason: string }> {
  const connector = CONNECTORS[input.id];
  if (!connector.listEndpoint) return { ok: true, choices: [] };
  const token = await usableToken(input.organizationId, input.id);
  if ('reason' in token) return { ok: false, reason: token.reason };

  const response = await fetch(connector.listEndpoint, {
    headers: { authorization: `Bearer ${token.token}` },
  });
  if (!response.ok)
    return {
      ok: false,
      reason: `${connector.label} returned ${response.status} when listing what this account can read.`,
    };
  const payload = (await response.json()) as Record<string, unknown>;

  if (input.id === 'search_console') {
    const entries = Array.isArray(payload.siteEntry) ? payload.siteEntry : [];
    return {
      ok: true,
      choices: entries
        .map(
          (entry: unknown) =>
            entry as { siteUrl?: string; permissionLevel?: string },
        )
        .filter(
          (entry) =>
            entry.siteUrl && entry.permissionLevel !== 'siteUnverifiedUser',
        )
        .map((entry) => ({ id: entry.siteUrl!, label: entry.siteUrl! })),
    };
  }

  const summaries = Array.isArray(payload.accountSummaries)
    ? payload.accountSummaries
    : [];
  const choices: Choice[] = [];
  for (const summary of summaries) {
    const account = summary as {
      displayName?: string;
      propertySummaries?: Array<{ property?: string; displayName?: string }>;
    };
    for (const property of account.propertySummaries ?? []) {
      if (!property.property) continue;
      choices.push({
        id: property.property.replace(/^properties\//, ''),
        label: `${account.displayName ?? 'Account'} · ${property.displayName ?? property.property}`,
      });
    }
  }
  return { ok: true, choices };
}

export async function chooseSource(input: {
  organizationId: string;
  id: ConnectorId;
  selection: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const connection = await loadConnection(input.organizationId, input.id);
  if (!connection)
    return { ok: false, reason: 'That connector is not authorised.' };
  await saveConnection({
    organizationId: input.organizationId,
    id: input.id,
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    expiresAt: connection.expiresAt,
    selection: input.selection,
  });
  return { ok: true };
}

export async function disconnect(organizationId: string, id: ConnectorId) {
  await getRawDb()
    .prepare(
      `DELETE FROM integration_connections WHERE organization_id = ? AND type = ?`,
    )
    .bind(organizationId, rowType(id))
    .run();
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export type ConnectorRead = {
  id: ConnectorId;
  observations: Observation[];
  /** Why nothing came back. Null when it did. */
  reason: string | null;
};

/**
 * Reads all connected sources and returns their observations.
 *
 * Never throws and never partially fails the board: a connector that is down
 * contributes its reason, and the rest of the evidence still renders.
 */
export async function readConnectors(
  organizationId: string,
): Promise<ConnectorRead[]> {
  const reads: ConnectorRead[] = [];
  for (const id of CONNECTOR_IDS) {
    try {
      reads.push(await readOne(organizationId, id));
    } catch (error) {
      reads.push({
        id,
        observations: [],
        reason:
          error instanceof Error
            ? error.message
            : `${CONNECTORS[id].label} could not be read.`,
      });
    }
  }
  return reads;
}

async function readOne(
  organizationId: string,
  id: ConnectorId,
): Promise<ConnectorRead> {
  const connection = await loadConnection(organizationId, id);
  if (!connection?.accessToken) return { id, observations: [], reason: null };
  if (CONNECTORS[id].needsSelection && !connection.selection)
    return {
      id,
      observations: [],
      reason: `No ${CONNECTORS[id].selectionLabel} chosen yet, so nothing was read.`,
    };

  const token = await usableToken(organizationId, id);
  if ('reason' in token) return { id, observations: [], reason: token.reason };

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);

  if (id === 'google_analytics') {
    const response = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(connection.selection!)}:runReport`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          dateRanges: [{ startDate: since, endDate: until }],
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: [{ name: 'sessions' }],
          limit: 20,
        }),
      },
    );
    if (!response.ok)
      return {
        id,
        observations: [],
        reason: `Google Analytics returned ${response.status} for that property.`,
      };
    const payload = (await response.json()) as { rows?: unknown[] };
    await markSynced(organizationId, id);
    return {
      id,
      observations: analyticsObservations({
        rows: (payload.rows ?? []) as never,
        windowDays: WINDOW_DAYS,
      }),
      reason: null,
    };
  }

  if (id === 'search_console') {
    const response = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(connection.selection!)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          startDate: since,
          endDate: until,
          dimensions: ['query'],
          rowLimit: 100,
        }),
      },
    );
    if (!response.ok)
      return {
        id,
        observations: [],
        reason: `Search Console returned ${response.status} for that site.`,
      };
    const payload = (await response.json()) as { rows?: unknown[] };
    await markSynced(organizationId, id);
    return {
      id,
      observations: searchObservations({
        rows: (payload.rows ?? []) as never,
        windowDays: WINDOW_DAYS,
      }),
      reason: null,
    };
  }

  const response = await fetch(
    'https://api.hubapi.com/crm/v3/objects/deals?limit=100&properties=dealstage,amount,closedate',
    { headers: { authorization: `Bearer ${token.token}` } },
  );
  if (!response.ok)
    return {
      id,
      observations: [],
      reason: `HubSpot returned ${response.status} when reading deals.`,
    };
  const payload = (await response.json()) as { results?: unknown[] };
  await markSynced(organizationId, id);
  return {
    id,
    observations: hubspotObservations({
      deals: (payload.results ?? []) as never,
    }),
    reason: null,
  };
}

async function markSynced(organizationId: string, id: ConnectorId) {
  await getRawDb()
    .prepare(
      `UPDATE integration_connections SET last_checked_at = CURRENT_TIMESTAMP
       WHERE organization_id = ? AND type = ?`,
    )
    .bind(organizationId, rowType(id))
    .run();
}

function safeObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function base64Url(buffer: ArrayBuffer) {
  let binary = '';
  for (const byte of new Uint8Array(buffer))
    binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
