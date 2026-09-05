/**
 * Google Analytics, Search Console and HubSpot for the AI Business Manager
 * (§6: "Analytics connection", "Search connection", "CRM connection").
 *
 * The growth board already names these three as sources it does not have, and
 * the chat refuses questions that need them — "I don't have access to your
 * Google Analytics data", with the honest addendum that a made-up benchmark
 * would be worse than no number. This is the other half: connecting them for
 * real, and turning what comes back into evidence that carries its source and
 * sample size like everything else on that board.
 *
 * Two design decisions worth stating.
 *
 * **The OAuth app belongs to the platform, not the customer.** A workspace
 * should press Connect, not register a Google Cloud project. So the client id
 * and secret are platform provider secrets set once by the platform admin, and
 * a workspace whose platform has not set them is told exactly that rather than
 * shown a button that fails.
 *
 * **Authorised is not connected.** Google hands back a token that can read
 * *some* property or site; which one is a separate question, and a connector
 * that quietly picks the first is a connector that reports a different
 * business's numbers. So `needs_selection` is its own state, and no
 * observation is produced until somebody chooses.
 *
 * Pure: the definitions, the authorise URL, the state machine, and the
 * translation from each API's payload into observations.
 */

import { observe, type Observation } from './growth-manager.ts';

export type ConnectorId = 'google_analytics' | 'search_console' | 'hubspot';

export const CONNECTOR_IDS: ConnectorId[] = [
  'google_analytics',
  'search_console',
  'hubspot',
];

export type ConnectorDefinition = {
  id: ConnectorId;
  label: string;
  /** What connecting it lets the growth manager answer. */
  answers: string;
  /** The platform provider key that holds the OAuth app's credentials. */
  platformProvider: string;
  authorizeEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
  /** Whether a property, site or portal must be chosen after authorising. */
  needsSelection: boolean;
  selectionLabel: string;
  /** Where the granted account's choices are listed. */
  listEndpoint: string | null;
};

export const CONNECTORS: Record<ConnectorId, ConnectorDefinition> = {
  google_analytics: {
    id: 'google_analytics',
    label: 'Google Analytics',
    answers:
      'How many people reach your site, where they come from, and which pages they land on.',
    platformProvider: 'google_oauth',
    authorizeEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    needsSelection: true,
    selectionLabel: 'GA4 property',
    listEndpoint:
      'https://analyticsadmin.googleapis.com/v1beta/accountSummaries',
  },
  search_console: {
    id: 'search_console',
    label: 'Search Console',
    answers:
      'What people search before they find you, and where you rank for it.',
    platformProvider: 'google_oauth',
    authorizeEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    needsSelection: true,
    selectionLabel: 'verified site',
    listEndpoint: 'https://www.googleapis.com/webmasters/v3/sites',
  },
  hubspot: {
    id: 'hubspot',
    label: 'HubSpot',
    answers:
      'Where your deals stall, and what your pipeline is actually worth.',
    platformProvider: 'hubspot_oauth',
    authorizeEndpoint: 'https://app.hubspot.com/oauth/authorize',
    tokenEndpoint: 'https://api.hubapi.com/oauth/v1/token',
    scopes: ['crm.objects.contacts.read', 'crm.objects.deals.read'],
    // HubSpot's token is already scoped to one portal, so there is nothing
    // left to choose.
    needsSelection: false,
    selectionLabel: 'portal',
    listEndpoint: null,
  },
};

export function isConnectorId(value: unknown): value is ConnectorId {
  return (
    typeof value === 'string' && CONNECTOR_IDS.includes(value as ConnectorId)
  );
}

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

export type ConnectorState =
  | 'platform_not_configured'
  | 'not_connected'
  | 'needs_selection'
  | 'expired'
  | 'connected';

export type ConnectorStatus = {
  id: ConnectorId;
  label: string;
  state: ConnectorState;
  /** What the workspace should read. Never "error". */
  message: string;
  /** Whether pressing Connect can achieve anything right now. */
  canConnect: boolean;
  selection: string | null;
  lastSyncedAt: string | null;
};

export function connectorStatus(input: {
  connector: ConnectorDefinition;
  /** The platform has registered an OAuth app for this provider. */
  platformReady: boolean;
  connection: {
    hasToken: boolean;
    selection: string | null;
    expiresAt: string | null;
    hasRefreshToken: boolean;
    lastSyncedAt: string | null;
  } | null;
  now?: Date;
}): ConnectorStatus {
  const { connector, connection } = input;
  const base = {
    id: connector.id,
    label: connector.label,
    selection: connection?.selection ?? null,
    lastSyncedAt: connection?.lastSyncedAt ?? null,
  };

  if (!input.platformReady)
    return {
      ...base,
      state: 'platform_not_configured',
      // Named precisely, because the fix belongs to somebody else. A generic
      // "unavailable" sends a customer looking for a setting they do not have.
      message: `Vaani has not registered a ${connector.label} app yet. Your platform administrator sets that once, and then this becomes a single click.`,
      canConnect: false,
    };

  if (!connection?.hasToken)
    return {
      ...base,
      state: 'not_connected',
      message: `Not connected. ${connector.answers}`,
      canConnect: true,
    };

  if (connector.needsSelection && !connection.selection)
    return {
      ...base,
      state: 'needs_selection',
      // The state that stops the connector reporting the wrong business's
      // numbers: authorised, but nobody has said which property.
      message: `Authorised, but no ${connector.selectionLabel} has been chosen yet. Nothing is read until you pick one.`,
      canConnect: true,
    };

  if (isExpired(connection.expiresAt, input.now) && !connection.hasRefreshToken)
    return {
      ...base,
      state: 'expired',
      message: `The ${connector.label} authorisation has run out and there is no refresh token to renew it. Connect it again.`,
      canConnect: true,
    };

  return {
    ...base,
    state: 'connected',
    message: connection.lastSyncedAt
      ? `Connected. Last read ${connection.lastSyncedAt}.`
      : 'Connected. Nothing has been read yet.',
    canConnect: false,
  };
}

/** Whether the access token should be renewed before the next request. */
export function needsRefresh(
  expiresAt: string | null,
  now = new Date(),
): boolean {
  if (!expiresAt) return false;
  const expiry = parseTime(expiresAt);
  if (!expiry) return true;
  // Sixty seconds of slack: a token that expires mid-request is a failure
  // nobody can explain from the logs.
  return expiry.getTime() - now.getTime() < 60_000;
}

function isExpired(expiresAt: string | null, now = new Date()): boolean {
  if (!expiresAt) return false;
  const expiry = parseTime(expiresAt);
  return expiry ? expiry.getTime() <= now.getTime() : true;
}

function parseTime(value: string): Date | null {
  const text = value.trim();
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date;
}

/* ------------------------------------------------------------------ *
 * The authorise URL
 * ------------------------------------------------------------------ */

export function authorizeUrl(input: {
  connector: ConnectorDefinition;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge?: string;
}): string {
  const url = new URL(input.connector.authorizeEndpoint);
  const params: Record<string, string> = {
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: input.connector.scopes.join(' '),
    state: input.state,
  };
  if (input.connector.platformProvider === 'google_oauth') {
    // Without both of these Google returns no refresh token on a repeat
    // authorisation, and the connector silently dies a week later.
    params.access_type = 'offline';
    params.prompt = 'consent';
    if (input.codeChallenge) {
      params.code_challenge = input.codeChallenge;
      params.code_challenge_method = 'S256';
    }
  }
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

/* ------------------------------------------------------------------ *
 * Turning each API's payload into evidence
 * ------------------------------------------------------------------ */

export type GaRow = {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
};

/**
 * Google Analytics: sessions by channel over the window.
 *
 * The sample size is the number of sessions, not the number of rows — five
 * channels totalling eleven sessions is eleven sessions of evidence, and
 * `observe` refuses anything under its own floor either way.
 */
export function analyticsObservations(input: {
  rows: GaRow[];
  windowDays: number;
}): Observation[] {
  const channels = input.rows
    .map((row) => ({
      channel: row.dimensionValues?.[0]?.value ?? 'Unknown',
      sessions: Number(row.metricValues?.[0]?.value ?? 0),
    }))
    .filter((row) => Number.isFinite(row.sessions) && row.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions);
  const total = channels.reduce((sum, row) => sum + row.sessions, 0);
  if (total === 0) return [];

  const observations: Observation[] = [];
  const sessions = observe({
    id: 'ga_sessions',
    statement: `${total} sessions reached your site in the last ${input.windowDays} days.`,
    source: 'google_analytics',
    metric: { label: 'Sessions', value: total, unit: 'sessions' },
    sampleSize: total,
  });
  if (sessions) observations.push(sessions);

  const top = channels[0];
  if (top) {
    const share = Math.round((top.sessions / total) * 100);
    const concentration = observe({
      id: 'ga_top_channel',
      statement: `${share}% of those sessions came from ${top.channel}.`,
      source: 'google_analytics',
      metric: { label: `${top.channel} share`, value: share, unit: '%' },
      sampleSize: total,
    });
    if (concentration) observations.push(concentration);
  }
  return observations;
}

export type GscRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

/**
 * Search Console: what people search, and where you actually rank for it.
 *
 * Impressions are the sample. A query with three impressions is not evidence
 * of anything, and the average position over such a query is noise.
 */
export function searchObservations(input: {
  rows: GscRow[];
  windowDays: number;
}): Observation[] {
  const rows = input.rows.filter((row) => Number(row.impressions ?? 0) > 0);
  const impressions = rows.reduce(
    (sum, row) => sum + Number(row.impressions ?? 0),
    0,
  );
  const clicks = rows.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0);
  if (impressions === 0) return [];

  const observations: Observation[] = [];
  const ctr = Math.round((clicks / impressions) * 1000) / 10;
  const reach = observe({
    id: 'gsc_impressions',
    statement: `Your pages were shown ${impressions} times in Google search over ${input.windowDays} days, and clicked ${clicks} times (${ctr}%).`,
    source: 'search_console',
    metric: { label: 'Search click-through', value: ctr, unit: '%' },
    sampleSize: impressions,
  });
  if (reach) observations.push(reach);

  // The most-shown query you are not winning. Ranked by impressions rather
  // than by worst position, because position 40 on a query nobody searches is
  // not a problem worth anybody's morning.
  const missed = rows
    .filter((row) => Number(row.position ?? 0) > 10)
    .sort((a, b) => Number(b.impressions ?? 0) - Number(a.impressions ?? 0))[0];
  if (missed?.keys?.[0]) {
    const position = Math.round(Number(missed.position ?? 0));
    const buried = observe({
      id: 'gsc_buried_query',
      statement: `“${missed.keys[0]}” showed your site ${missed.impressions} times but ranks around position ${position}, so almost nobody clicks it.`,
      source: 'search_console',
      metric: { label: 'Average position', value: position },
      sampleSize: Number(missed.impressions ?? 0),
    });
    if (buried) observations.push(buried);
  }
  return observations;
}

export type HubspotDeal = {
  properties?: {
    dealstage?: string | null;
    amount?: string | null;
    closedate?: string | null;
  };
};

/**
 * HubSpot: where the pipeline sits.
 *
 * Stage labels are HubSpot's internal ids unless the caller maps them, so they
 * are shown as they come rather than prettified into something that looks
 * official and might be wrong.
 */
export function hubspotObservations(input: {
  deals: HubspotDeal[];
  stageLabels?: Record<string, string>;
}): Observation[] {
  const deals = input.deals.filter((deal) => deal.properties);
  if (deals.length === 0) return [];

  const byStage = new Map<string, { count: number; value: number }>();
  let totalValue = 0;
  for (const deal of deals) {
    const stage = deal.properties?.dealstage ?? 'unknown';
    const amount = Number(deal.properties?.amount ?? 0);
    const value = Number.isFinite(amount) ? amount : 0;
    totalValue += value;
    const current = byStage.get(stage) ?? { count: 0, value: 0 };
    byStage.set(stage, {
      count: current.count + 1,
      value: current.value + value,
    });
  }

  const observations: Observation[] = [];
  const size = observe({
    id: 'hubspot_pipeline',
    statement: `${deals.length} open deals in HubSpot, worth ${Math.round(totalValue)} in total.`,
    source: 'hubspot',
    metric: { label: 'Pipeline value', value: Math.round(totalValue) },
    sampleSize: deals.length,
  });
  if (size) observations.push(size);

  const biggest = [...byStage.entries()].sort(
    (a, b) => b[1].count - a[1].count,
  )[0];
  if (biggest) {
    const [stage, stats] = biggest;
    const label = input.stageLabels?.[stage] ?? stage;
    const share = Math.round((stats.count / deals.length) * 100);
    const stalled = observe({
      id: 'hubspot_stage_concentration',
      statement: `${share}% of them are sitting in “${label}”.`,
      source: 'hubspot',
      metric: { label: `${label} share`, value: share, unit: '%' },
      sampleSize: deals.length,
    });
    if (stalled) observations.push(stalled);
  }
  return observations;
}
