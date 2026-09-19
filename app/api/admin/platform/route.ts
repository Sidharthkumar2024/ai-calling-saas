import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireAdminCapability, type AdminCapability } from '@/lib/admin-rbac';
import { recordAudit } from '@/lib/demo-seed';

import { isUsageUnit, USAGE_UNITS } from '@/lib/rate-cards';
import {
  platformProviderSecret,
  providerReadiness,
} from '@/lib/provider-adapters';
import { encryptSecret } from '@/lib/security';
import { splitProviderConfig } from '@/lib/provider-secret-policy';
import { googleAuthConfig } from '@/lib/google-auth-config';
import { customerUsageRates } from '@/lib/customer-usage-pricing';
import { verifySmtp, type SmtpCredentials } from '@/lib/smtp-email';

// Providers whose keys the admin panel may store.
// Sign-in providers whose OAuth credentials the platform admin may store.
const AUTH_PROVIDERS = new Set(['google', 'github', 'microsoft']);

const MANAGED_PROVIDERS = new Set([
  'sarvam',
  'elevenlabs',
  'anthropic',
  'openai',
  'deepgram',
  'cartesia',
  'bolna',
  'resend',
  'smtp',
  'razorpay',
  'stripe',
  'payu',
  'phonepe',
  'paytm',
  'cashfree',
  'whatsapp',
  'exotel',
  'vobiz',
  'twilio',
  'sms',
  // The OAuth apps behind the growth manager's connectors (§6). Registered
  // once by the platform so a workspace presses Connect instead of creating a
  // Google Cloud project of its own. The client id and redirect URL go in
  // `config`; the client secret is the encrypted key.
  'google_oauth',
  'hubspot_oauth',
]);

export const dynamic = 'force-dynamic';

// Adapter name -> platform_providers row. Used to write the measured readiness
// back onto the row so the stored health cannot contradict the live check.
const PROVIDER_ROW_IDS: Record<string, string> = {
  sarvam: 'provider_sarvam',
  elevenlabs: 'provider_elevenlabs',
  openai: 'provider_openai',
  anthropic: 'provider_anthropic',
  razorpay: 'provider_razorpay',
  stripe: 'provider_stripe',
  payu: 'provider_payu',
  phonepe: 'provider_phonepe',
  paytm: 'provider_paytm',
  cashfree: 'provider_cashfree',
  smtp: 'provider_email',
  whatsapp: 'provider_whatsapp',
  exotel: 'provider_telephony',
  vobiz: 'provider_vobiz',
  bolna: 'provider_bolna',
  cartesia: 'provider_cartesia',
  sms: 'provider_sms',
};

/**
 * Which sub-role capability each action needs (§31, blueprint §21).
 *
 * This route used to take a bare `requireAdmin`, so the sub-roles existed on
 * paper while every admin could rotate provider keys, change sign-in providers
 * and edit plans. Anything not listed falls to `security.manage`, so a new
 * action is locked down by default rather than open by omission.
 */
/** The kinds of cost a rate card can describe. */
const RATE_CATEGORIES = [
  'llm',
  'stt',
  'tts',
  'telephony',
  'messaging',
  'storage',
  'payments',
  'infrastructure',
] as const;

const ACTION_CAPABILITIES: Record<string, AdminCapability> = {
  provider_key_save: 'providers.manage',
  provider_key_clear: 'providers.manage',
  provider_status: 'providers.manage',
  smtp_test: 'providers.manage',
  elevenlabs_tts_test: 'providers.manage',
  elevenlabs_voices: 'providers.manage',
  auth_visibility: 'security.manage',
  auth_provider_save: 'security.manage',
  auth_enabled: 'security.manage',
  plan_update: 'billing.manage',
  plan_create: 'billing.manage',
  credit_package_create: 'billing.manage',
  credit_package_status: 'billing.manage',
  fx_rate_set: 'billing.manage',
  rate_card_set: 'billing.manage',
  customer_usage_rate_update: 'billing.manage',
  price_book_set: 'billing.manage',
  kyc_status: 'tenants.manage',
  kyc_document_review: 'tenants.manage',
  voice_consent_review: 'security.manage',
  voice_block: 'security.manage',
  ticket_reply: 'support.access',
  ticket_status: 'support.access',
};

export async function GET(request: Request) {
  const auth = await requireAdminCapability(request, 'tenants.read');
  if (auth.response) return auth.response;
  await ensureSchema();
  const db = getRawDb();
  const [
    authProviders,
    platformProviders,
    providerKeys,
    tickets,
    messages,
    voiceConsents,
    customerUsageRateRows,
  ] = await Promise.all([
    db
      .prepare(
        'SELECT provider, display_name, button_visible, enabled, status, public_config_json, updated_at FROM auth_provider_settings ORDER BY display_name',
      )
      .all(),
    db
      .prepare(
        'SELECT id, public_name, category, required_credentials_json, status, health, usage_note, customer_visible, updated_at FROM platform_providers ORDER BY category, public_name',
      )
      .all(),
    db
      .prepare(
        `SELECT provider, CASE WHEN encrypted_secret IS NULL THEN 0 ELSE 1 END AS has_secret,
             public_config_json, updated_at FROM platform_provider_secrets`,
      )
      .all(),
    db
      .prepare(`SELECT t.*, o.name AS organization_name, u.email AS creator_email FROM support_tickets t
      INNER JOIN organizations o ON o.id = t.organization_id LEFT JOIN app_users u ON u.id = t.created_by_user_id
      ORDER BY t.updated_at DESC`)
      .all(),
    db
      .prepare('SELECT * FROM support_ticket_messages ORDER BY created_at')
      .all(),
    // Voice consent waiting on a reviewer. A workspace can submit one and
    // the review action has always existed; until this query nobody could
    // see the queue, so a submission went nowhere and the voice stayed
    // unusable with no explanation.
    db
      .prepare(`SELECT c.voice_profile_id, c.speaker_name, c.relationship,
            c.statement, c.evidence_key, c.state, c.review_note, c.created_at,
            p.name AS profile_name, p.provider,
            coalesce(p.platform_blocked, 0) AS platform_blocked,
            p.platform_block_reason,
            o.name AS organization_name, o.id AS organization_id
          FROM voice_consents c
          INNER JOIN voice_profiles p ON p.id = c.voice_profile_id
          LEFT JOIN organizations o ON o.id = c.organization_id
          WHERE c.state IN ('pending', 'rejected') OR p.platform_blocked = 1
          ORDER BY c.state = 'pending' DESC, c.created_at`)
      .all(),
    customerUsageRates(),
  ]);
  const readiness = await providerReadiness();
  // Persist the measured result. `status` stays operator-controlled (they may
  // deliberately disable a provider); only `health` is synced, so the portal
  // never shows a stale "connected" next to a failing check.
  await Promise.all(
    readiness
      .filter((entry) => PROVIDER_ROW_IDS[entry.adapter])
      .map((entry) =>
        db
          .prepare(
            `UPDATE platform_providers SET health = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          )
          .bind(
            entry.configured ? 'connected' : 'not_connected',
            PROVIDER_ROW_IDS[entry.adapter],
          )
          .run(),
      ),
  );

  // The SELECT above ran before that update, so reflect the measured health in
  // this response too rather than returning a row we just superseded.
  const measuredHealth = new Map(
    readiness
      .filter((entry) => PROVIDER_ROW_IDS[entry.adapter])
      .map((entry) => [
        PROVIDER_ROW_IDS[entry.adapter],
        entry.configured ? 'connected' : 'not_connected',
      ]),
  );
  const platformProviderRows = (platformProviders.results ?? []).map((row) => {
    const id = (row as { id?: string }).id;
    const health = id ? measuredHealth.get(id) : undefined;
    return health ? { ...row, health } : row;
  });

  return NextResponse.json({
    authProviders: authProviders.results,
    voiceConsents: voiceConsents.results,
    platformProviders: platformProviderRows,
    providerKeys: providerKeys.results.map((row) => {
      let value: unknown = {};
      try {
        value = JSON.parse(
          typeof row.public_config_json === 'string'
            ? row.public_config_json
            : '{}',
        );
      } catch {
        /* A malformed legacy row must not break the admin screen. */
      }
      return {
        ...row,
        public_config_json: JSON.stringify(splitProviderConfig(value).config),
      };
    }),
    providerReadiness: readiness,
    customerUsageRates: customerUsageRateRows,
    tickets: tickets.results,
    ticketMessages: messages.results,
  });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    action?: string;
    provider?: string;
    buttonVisible?: boolean;
    enabled?: boolean;
    id?: string;
    status?: string;
    health?: string;
    ticketId?: string;
    message?: string;
    planId?: string;
    code?: string;
    name?: string;
    monthlyPrice?: number;
    includedCredits?: number;
    maxAgents?: number;
    maxNumbers?: number;
    concurrency?: number;
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    credits?: number;
    price?: number;
    numberId?: string;
    rejectionReason?: string;
    apiKey?: string;
    config?: Record<string, string>;
    packageId?: string;
    documentId?: string;
    category?: string;
    unit?: string;
    priceMicros?: number;
    rateId?: string;
    creditsPerUnit?: number;
    customerNote?: string;
    marginNote?: string;
    model?: string;
    baseCurrency?: string;
    quoteCurrency?: string;
    rate?: number;
    effectiveFrom?: string;
    source?: string;
    productType?: string;
    productId?: string;
    country?: string;
    currency?: string;
    amountMinor?: number;
    active?: boolean;
  };
  const auth = await requireAdminCapability(
    request,
    ACTION_CAPABILITIES[body.action ?? ''] ?? 'security.manage',
  );
  if (auth.response) return auth.response;
  await ensureSchema();
  const db = getRawDb();

  if (body.action === 'provider_key_save') {
    if (
      (typeof body.apiKey === 'string' && body.apiKey.length > 4000) ||
      (body.config &&
        typeof body.config === 'object' &&
        Object.values(body.config).some(
          (value) => typeof value === 'string' && value.length > 4000,
        ))
    )
      return NextResponse.json(
        {
          error:
            'Each credential or configuration value must be at most 4000 characters.',
        },
        { status: 400 },
      );
    const provider = String(body.provider || '');
    if (!MANAGED_PROVIDERS.has(provider))
      return NextResponse.json(
        { error: 'Unsupported provider.' },
        { status: 400 },
      );
    const split = splitProviderConfig(body.config);
    const previous = await platformProviderSecret(provider);
    const config = JSON.stringify(split.config);
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (
      apiKey ||
      Object.keys(split.secrets).length ||
      Object.keys(previous.secrets).length
    ) {
      const encrypted = await encryptSecret(
        JSON.stringify({
          ...previous.secrets,
          ...split.secrets,
          ...(apiKey ? { apiKey } : {}),
        }),
      );
      await db
        .prepare(
          `INSERT INTO platform_provider_secrets (provider, encrypted_secret, public_config_json, updated_by, updated_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(provider) DO UPDATE SET encrypted_secret = excluded.encrypted_secret,
             public_config_json = excluded.public_config_json, updated_by = excluded.updated_by,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(provider, encrypted, config, auth.session.userId)
        .run();
    } else {
      // No new key supplied — update only the non-secret config (e.g. voiceId).
      await db
        .prepare(
          `INSERT INTO platform_provider_secrets (provider, public_config_json, updated_by, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(provider) DO UPDATE SET public_config_json = excluded.public_config_json,
             updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(provider, config, auth.session.userId)
        .run();
    }
    await recordAudit(
      auth.session,
      'provider_key.saved',
      'platform_provider',
      provider,
      {
        hasKey: Boolean(apiKey),
        config: split.config,
        secretFieldsUpdated: Object.keys(split.secrets),
      },
    );
    return NextResponse.json({ saved: true });
  }

  if (body.action === 'provider_key_clear') {
    const provider = String(body.provider || '');
    if (!MANAGED_PROVIDERS.has(provider))
      return NextResponse.json(
        { error: 'Unsupported provider.' },
        { status: 400 },
      );
    await db
      .prepare(`DELETE FROM platform_provider_secrets WHERE provider = ?`)
      .bind(provider)
      .run();
    await recordAudit(
      auth.session,
      'provider_key.cleared',
      'platform_provider',
      provider,
      {},
    );
    return NextResponse.json({ cleared: true });
  }

  if (body.action === 'smtp_test') {
    const stored = await platformProviderSecret('smtp');
    const config = stored.config as Record<string, unknown>;
    const password = stored.secrets.password;
    const credentials: SmtpCredentials | null =
      !stored.disabled &&
      typeof config.host === 'string' &&
      typeof config.username === 'string' &&
      typeof config.fromAddress === 'string' &&
      typeof password === 'string'
        ? {
            host: config.host,
            port: Math.max(1, Number(config.port) || 465),
            secure: String(config.secure ?? 'true') !== 'false',
            username: config.username,
            password,
            from: config.fromAddress,
            fromName:
              typeof config.fromName === 'string'
                ? config.fromName
                : 'Call Vani',
          }
        : null;
    if (!credentials)
      return NextResponse.json(
        { error: 'Save the complete SMTP configuration first.' },
        { status: 400 },
      );
    try {
      await verifySmtp(credentials);
      await recordAudit(
        auth.session,
        'provider.smtp_verified',
        'platform_provider',
        'smtp',
        { host: credentials.host, port: credentials.port },
      );
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json(
        {
          error:
            'SMTP authentication or TLS verification failed. Check the saved mailbox credentials.',
        },
        { status: 502 },
      );
    }
  }

  if (body.action === 'elevenlabs_tts_test') {
    const secret = await platformProviderSecret('elevenlabs');
    const apiKey = secret.apiKey || process.env.ELEVENLABS_API_KEY;
    const cfg = (secret.config ?? {}) as Record<string, unknown>;
    const cfgStr = (key: string) =>
      typeof cfg[key] === 'string' ? (cfg[key] as string) : '';
    const voiceId =
      body.config?.voiceId ||
      cfgStr('voiceId') ||
      process.env.ELEVENLABS_VOICE_ID ||
      '';
    if (!apiKey)
      return NextResponse.json(
        { error: 'Save the ElevenLabs API key first.' },
        { status: 400 },
      );
    if (!voiceId)
      return NextResponse.json(
        { error: 'Set a default voice ID first.' },
        { status: 400 },
      );
    const modelId =
      body.config?.modelId ||
      cfgStr('modelId') ||
      process.env.ELEVENLABS_MODEL_ID ||
      'eleven_multilingual_v2';
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            accept: 'audio/mpeg',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            text: 'Namaste, this is a Vaani voice test.',
            model_id: modelId,
            output_format: 'mp3_44100_128',
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!response.ok) {
        const raw = await response.text();
        let reason = raw.slice(0, 200);
        try {
          const parsed = JSON.parse(raw) as { detail?: unknown };
          const d = parsed.detail as
            | { status?: string; message?: string }
            | string;
          reason =
            typeof d === 'string'
              ? d
              : `${d?.status ?? ''}${d?.message ? `: ${d.message}` : ''}`;
        } catch {
          /* keep raw */
        }
        return NextResponse.json(
          {
            error: `TTS failed (${response.status}): ${reason}`,
            voiceId,
            modelId,
          },
          { status: 502 },
        );
      }
      const bytes = (await response.arrayBuffer()).byteLength;
      return NextResponse.json({ ok: true, voiceId, modelId, bytes });
    } catch {
      return NextResponse.json(
        { error: 'Could not reach ElevenLabs.' },
        { status: 502 },
      );
    }
  }

  if (body.action === 'elevenlabs_voices') {
    const apiKey =
      (typeof body.apiKey === 'string' && body.apiKey.trim()) ||
      process.env.ELEVENLABS_API_KEY ||
      (await platformProviderSecret('elevenlabs')).apiKey;
    if (!apiKey)
      return NextResponse.json(
        { error: 'Save the ElevenLabs API key first.' },
        { status: 400 },
      );
    try {
      const response = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      const payload = (await response.json()) as {
        voices?: Array<{
          voice_id: string;
          name: string;
          category?: string;
          labels?: Record<string, string>;
        }>;
        detail?: unknown;
      };
      if (!response.ok || !Array.isArray(payload.voices)) {
        const detail =
          payload.detail &&
          typeof payload.detail === 'object' &&
          'message' in payload.detail
            ? String((payload.detail as { message?: unknown }).message)
            : typeof payload.detail === 'string'
              ? payload.detail
              : '';
        const status =
          payload.detail &&
          typeof payload.detail === 'object' &&
          'status' in payload.detail
            ? String((payload.detail as { status?: unknown }).status)
            : '';
        return NextResponse.json(
          {
            error: `ElevenLabs rejected the key (${response.status}${status ? ` · ${status}` : ''})${detail ? `: ${detail}` : ''}`,
          },
          { status: 502 },
        );
      }
      const voices = payload.voices.map((voice) => ({
        voiceId: voice.voice_id,
        name: voice.name,
        category: voice.category ?? '',
        labels: voice.labels ?? {},
      }));
      return NextResponse.json({ voices });
    } catch {
      return NextResponse.json(
        { error: 'Could not reach ElevenLabs.' },
        { status: 502 },
      );
    }
  }
  if (body.action === 'auth_visibility') {
    const result = await db
      .prepare(
        `UPDATE auth_provider_settings SET button_visible = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE provider = ?`,
      )
      .bind(body.buttonVisible ? 1 : 0, auth.session.userId, body.provider)
      .run();
    if (!result.meta.changes)
      return NextResponse.json(
        { error: 'Auth provider not found.' },
        { status: 404 },
      );
    await recordAudit(
      auth.session,
      'auth_provider.visibility_updated',
      'auth_provider',
      body.provider,
      { buttonVisible: body.buttonVisible },
    );
    return NextResponse.json({ updated: true });
  }
  if (body.action === 'auth_provider_save') {
    // The table already had credential columns but nothing wrote them, so
    // `configured` was hardcoded false for every provider except Google and no
    // other sign-in method could ever be enabled.
    const provider = String(body.provider ?? '');
    if (!AUTH_PROVIDERS.has(provider))
      return NextResponse.json(
        { error: 'Unsupported sign-in provider.' },
        { status: 400 },
      );
    const clientId = String(body.clientId ?? '').trim();
    const clientSecret = String(body.clientSecret ?? '').trim();
    const redirectUri = String(body.redirectUri ?? '').trim();
    if (!clientId || !clientSecret || !redirectUri)
      return NextResponse.json(
        { error: 'Client ID, client secret and redirect URI are required.' },
        { status: 400 },
      );
    try {
      const parsed = new URL(redirectUri);
      if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error();
    } catch {
      return NextResponse.json(
        { error: 'Redirect URI must be a valid URL.' },
        { status: 400 },
      );
    }
    const result = await db
      .prepare(`UPDATE auth_provider_settings
        SET public_config_json = ?, encrypted_secret = ?, status = 'configured',
            updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE provider = ?`)
      .bind(
        JSON.stringify({
          clientId,
          redirectUri,
          secretHint: `••••${clientSecret.slice(-4)}`,
        }),
        await encryptSecret(clientSecret),
        auth.session.userId,
        provider,
      )
      .run();
    if (!result.meta.changes)
      return NextResponse.json(
        { error: 'Auth provider not found.' },
        { status: 404 },
      );
    await recordAudit(
      auth.session,
      'auth_provider.credentials_saved',
      'auth_provider',
      provider,
      { redirectUri },
    );
    return NextResponse.json({
      ok: true,
      provider,
      status: 'configured',
      message:
        'Credentials stored encrypted. Enable the provider to show its sign-in button.',
    });
  }

  if (body.action === 'auth_enabled') {
    const provider = String(body.provider ?? '');
    if (!AUTH_PROVIDERS.has(provider))
      return NextResponse.json(
        { error: 'Unsupported sign-in provider.' },
        { status: 400 },
      );
    // Configured means: credentials saved here, or the Google env bootstrap.
    const stored = await db
      .prepare(
        `SELECT public_config_json, encrypted_secret FROM auth_provider_settings WHERE provider = ? LIMIT 1`,
      )
      .bind(provider)
      .first<{ public_config_json: string; encrypted_secret: string | null }>();
    let hasStored = false;
    if (stored?.encrypted_secret) {
      try {
        const config = JSON.parse(stored.public_config_json || '{}') as {
          clientId?: unknown;
          redirectUri?: unknown;
        };
        hasStored =
          typeof config.clientId === 'string' &&
          config.clientId.length > 0 &&
          typeof config.redirectUri === 'string' &&
          config.redirectUri.length > 0;
      } catch {
        hasStored = false;
      }
    }
    const configured =
      provider === 'google' ? Boolean(await googleAuthConfig()) : hasStored;
    if (body.enabled && provider !== 'google')
      return NextResponse.json(
        {
          error:
            'This sign-in provider’s callback is not implemented yet. Keep it disabled.',
        },
        { status: 409 },
      );
    if (body.enabled && !configured) {
      return NextResponse.json(
        {
          error: 'Configure the provider credentials before enabling sign-in.',
        },
        { status: 409 },
      );
    }
    const result = await db
      .prepare(`UPDATE auth_provider_settings SET enabled = ?, status = ?, updated_by = ?,
      updated_at = CURRENT_TIMESTAMP WHERE provider = ?`)
      .bind(
        body.enabled ? 1 : 0,
        body.enabled ? 'active' : 'admin_disabled',
        auth.session.userId,
        body.provider,
      )
      .run();
    if (!result.meta.changes)
      return NextResponse.json(
        { error: 'Auth provider not found.' },
        { status: 404 },
      );
    await recordAudit(
      auth.session,
      'auth_provider.enabled_updated',
      'auth_provider',
      body.provider,
      { enabled: body.enabled },
    );
    return NextResponse.json({ updated: true });
  }
  if (body.action === 'provider_status') {
    const result = await db
      .prepare(
        `UPDATE platform_providers SET status = ?, health = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(body.status || 'required', body.health || 'not_connected', body.id)
      .run();
    if (!result.meta.changes)
      return NextResponse.json(
        { error: 'Platform provider not found.' },
        { status: 404 },
      );
    await recordAudit(
      auth.session,
      'platform_provider.status_updated',
      'platform_provider',
      body.id,
      { status: body.status ?? null, health: body.health ?? null },
    );
    return NextResponse.json({ updated: true });
  }
  // Plans existed only as demo seeds behind `NODE_ENV !== 'production'`, and
  // the panel could edit a plan but never create one. On a production database
  // the table was therefore empty, signup answered 503 "Free trial plan is not
  // configured", and there was no supported way out of that state.
  // §32: a person at the platform looks at the consent evidence before anyone
  // speaks in somebody else's voice. Nothing about a custom voice works until
  // this happens, which is the whole point of the section.
  if (body.action === 'voice_consent_review') {
    const decision = body.status === 'verified' ? 'verified' : 'rejected';
    const result = await db
      .prepare(
        `UPDATE voice_consents SET state = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP,
           review_note = ?
         WHERE voice_profile_id = ? AND state = 'pending'`,
      )
      .bind(
        decision,
        auth.session.email ?? auth.session.userId,
        (body.rejectionReason ?? '').trim().slice(0, 300) || null,
        body.id ?? '',
      )
      .run();
    if (!result.meta.changes)
      return NextResponse.json(
        { error: 'No consent is awaiting review for that voice.' },
        { status: 404 },
      );
    await recordAudit(
      auth.session,
      `voice_consent.${decision}`,
      'voice_profile',
      body.id ?? '',
      { note: body.rejectionReason ?? null },
    );
    return NextResponse.json({ reviewed: true, state: decision });
  }

  // The kill switch. Outranks a verified consent, because it is a decision
  // about the voice itself rather than about the workspace's paperwork.
  if (body.action === 'voice_block') {
    const blocked = body.status !== 'unblock';
    await db
      .prepare(
        `UPDATE voice_profiles SET platform_blocked = ?, platform_block_reason = ?
         WHERE id = ?`,
      )
      .bind(
        blocked ? 1 : 0,
        blocked
          ? (body.rejectionReason ?? '').trim().slice(0, 300) ||
              'Blocked by platform'
          : null,
        body.id ?? '',
      )
      .run();
    if (blocked)
      // A blocked voice is unbound from every agent using it, in every
      // workspace. Leaving it bound would mean the block took effect only on
      // the next binding rather than on the next call.
      await db
        .prepare(
          `UPDATE voice_agents SET voice_profile_id = NULL WHERE voice_profile_id = ?`,
        )
        .bind(body.id ?? '')
        .run();
    await recordAudit(
      auth.session,
      blocked ? 'voice.blocked' : 'voice.unblocked',
      'voice_profile',
      body.id ?? '',
      { reason: body.rejectionReason ?? null },
    );
    return NextResponse.json({ blocked });
  }

  if (body.action === 'plan_create') {
    const code = (body.code ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');
    if (!code || !body.name?.trim())
      return NextResponse.json(
        { error: 'Plan code and name are required.' },
        { status: 400 },
      );
    const existing = await db
      .prepare(`SELECT id FROM plans WHERE code = ? LIMIT 1`)
      .bind(code)
      .first<{ id: string }>();
    if (existing)
      return NextResponse.json(
        { error: `A plan with code "${code}" already exists.` },
        { status: 409 },
      );
    const planId = `plan_${code}`;
    await db
      .prepare(`INSERT INTO plans
        (id, code, name, monthly_price, included_credits, max_agents, max_numbers,
         concurrency, features_json, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)`)
      .bind(
        planId,
        code,
        body.name.trim().slice(0, 80),
        boundedInteger(body.monthlyPrice, 0, 100_000_000),
        boundedInteger(body.includedCredits, 0, 100_000_000),
        boundedInteger(body.maxAgents, 1, 100_000),
        boundedInteger(body.maxNumbers, 1, 100_000),
        boundedInteger(body.concurrency, 1, 1_000_000),
        body.status === 'inactive' ? 'inactive' : 'active',
      )
      .run();
    await recordAudit(auth.session, 'billing.plan_created', 'plan', planId, {
      code,
    });
    return NextResponse.json({ created: true, id: planId }, { status: 201 });
  }

  if (body.action === 'plan_update') {
    if (!body.planId || !body.name?.trim())
      return NextResponse.json(
        { error: 'Plan and name are required.' },
        { status: 400 },
      );
    const monthlyPrice = boundedInteger(body.monthlyPrice, 0, 100_000_000);
    const includedCredits = boundedInteger(
      body.includedCredits,
      0,
      100_000_000,
    );
    const maxAgents = boundedInteger(body.maxAgents, 1, 100_000);
    const maxNumbers = boundedInteger(body.maxNumbers, 1, 100_000);
    const concurrency = boundedInteger(body.concurrency, 1, 1_000_000);
    const status = body.status === 'inactive' ? 'inactive' : 'active';
    const result = await db
      .prepare(`UPDATE plans SET name = ?, monthly_price = ?, included_credits = ?,
      max_agents = ?, max_numbers = ?, concurrency = ?, status = ? WHERE id = ?`)
      .bind(
        body.name.trim().slice(0, 80),
        monthlyPrice,
        includedCredits,
        maxAgents,
        maxNumbers,
        concurrency,
        status,
        body.planId,
      )
      .run();
    if (!result.meta.changes)
      return NextResponse.json({ error: 'Plan not found.' }, { status: 404 });
    await recordAudit(
      auth.session,
      'billing.plan_updated',
      'plan',
      body.planId,
      { status, includedCredits, concurrency },
    );
    return NextResponse.json({ updated: true });
  }
  if (body.action === 'credit_package_create') {
    if (!body.name?.trim())
      return NextResponse.json(
        { error: 'Package name is required.' },
        { status: 400 },
      );
    const credits = boundedInteger(body.credits, 100, 100_000_000);
    const price = boundedInteger(body.price, 0, 100_000_000);
    const id = `credit_package_${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO credit_packages (id, name, credits, amount, status) VALUES (?, ?, ?, ?, 'active')`,
      )
      .bind(id, body.name.trim().slice(0, 80), credits, price)
      .run();
    await recordAudit(
      auth.session,
      'billing.credit_package_created',
      'credit_package',
      id,
      { credits, price },
    );
    return NextResponse.json({ created: true, id });
  }
  // A pack could be created and never retired, so an offer withdrawn from the
  // price list stayed buyable — every read filters on status = 'active' and
  // nothing could ever set it to anything else.
  if (body.action === 'credit_package_status') {
    const packageId = String(body.packageId ?? '');
    const status = body.status === 'active' ? 'active' : 'retired';
    const result = await db
      .prepare(`UPDATE credit_packages SET status = ? WHERE id = ?`)
      .bind(status, packageId)
      .run();
    if (!result.meta.changes)
      return NextResponse.json(
        { error: 'That credit package does not exist.' },
        { status: 404 },
      );
    await recordAudit(
      auth.session,
      `billing.credit_package_${status}`,
      'credit_package',
      packageId,
      {},
    );
    return NextResponse.json({ ok: true, status });
  }

  // `fx_rates` and `price_books` were read by the pricing layer and written by
  // nothing, so a workspace on a currency other than the base one could not be
  // priced at all. `priceForWorkspace` refuses rather than guessing — which was
  // the right behaviour and also meant it always refused.
  // What a provider charges us. There was no way to enter one: the seeded
  // cards came from the architecture document and nothing could add WhatsApp,
  // a server bill or a model this deployment actually uses.
  if (body.action === 'rate_card_set') {
    const provider = String(body.provider ?? '')
      .trim()
      .toLowerCase()
      .slice(0, 40);
    const category = String(body.category ?? '').trim();
    const unit = String(body.unit ?? '').trim();
    const priceMicros = Number(body.priceMicros);
    if (!provider)
      return NextResponse.json(
        { error: 'Name the provider this rate belongs to.' },
        { status: 400 },
      );
    if (!RATE_CATEGORIES.includes(category as never))
      return NextResponse.json(
        { error: `Category must be one of ${RATE_CATEGORIES.join(', ')}.` },
        { status: 400 },
      );
    if (!isUsageUnit(unit))
      return NextResponse.json(
        { error: `Unit must be one of ${USAGE_UNITS.join(', ')}.` },
        { status: 400 },
      );
    // A negative price would pay us to make calls. Zero is allowed and means
    // exactly zero — a provider on a free tier — which is different from
    // having no card at all.
    if (!Number.isFinite(priceMicros) || priceMicros < 0)
      return NextResponse.json(
        { error: 'The price must be zero or a positive number of micros.' },
        { status: 400 },
      );

    const id = `rate_${crypto.randomUUID()}`;
    const effectiveFrom = new Date().toISOString();
    await db
      .prepare(`INSERT INTO provider_rate_cards
        (id, provider, model, category, unit, price_micros, currency, effective_from, source, created_by)
        VALUES (?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?)`)
      .bind(
        id,
        provider,
        String(body.model ?? '').trim() || null,
        category,
        unit,
        Math.round(priceMicros),
        effectiveFrom,
        // Said plainly, so a figure somebody typed is never mistaken for one
        // taken from a provider's published price list.
        'Entered by Super Admin',
        auth.session.userId,
      )
      .run();
    await recordAudit(auth.session, 'billing.rate_card_set', 'rate_card', id, {
      provider,
      category,
      unit,
      priceMicros,
    });
    return NextResponse.json({ ok: true, id, provider, category, unit });
  }

  if (body.action === 'customer_usage_rate_update') {
    const rateId = String(body.rateId ?? '').trim();
    const existing = await db
      .prepare(
        `SELECT id, label FROM customer_usage_rates WHERE id = ? LIMIT 1`,
      )
      .bind(rateId)
      .first<{ id: string; label: string }>();
    if (!existing)
      return NextResponse.json(
        { error: 'That customer usage rate does not exist.' },
        { status: 404 },
      );
    const credits = boundedInteger(body.creditsPerUnit, 0, 100_000_000);
    const status = body.status === 'retired' ? 'retired' : 'active';
    const customerNote =
      typeof body.customerNote === 'string'
        ? body.customerNote.trim().slice(0, 400)
        : '';
    const marginNote =
      typeof body.marginNote === 'string'
        ? body.marginNote.trim().slice(0, 400)
        : '';
    await db
      .prepare(
        `UPDATE customer_usage_rates
         SET credits = ?, status = ?,
             customer_note = COALESCE(NULLIF(?, ''), customer_note),
             margin_note = COALESCE(NULLIF(?, ''), margin_note),
             updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(
        credits,
        status,
        customerNote,
        marginNote,
        auth.session.userId,
        rateId,
      )
      .run();
    await recordAudit(
      auth.session,
      'billing.customer_usage_rate_updated',
      'customer_usage_rate',
      rateId,
      { credits, status, customerNote, marginNote },
    );
    return NextResponse.json({
      ok: true,
      id: rateId,
      label: existing.label,
      credits,
      status,
    });
  }

  if (body.action === 'fx_rate_set') {
    const base = String(body.baseCurrency ?? '')
      .trim()
      .toUpperCase();
    const quote = String(body.quoteCurrency ?? '')
      .trim()
      .toUpperCase();
    const rate = Number(body.rate);
    if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(quote))
      return NextResponse.json(
        { error: 'Both currencies must be three-letter codes.' },
        { status: 400 },
      );
    if (base === quote)
      return NextResponse.json(
        { error: 'A currency does not need a rate against itself.' },
        { status: 400 },
      );
    // A zero or negative rate would price everything at nothing. Refused here
    // rather than discovered on an invoice.
    if (!Number.isFinite(rate) || rate <= 0)
      return NextResponse.json(
        { error: 'The rate must be a positive number.' },
        { status: 400 },
      );
    const effectiveFrom = /^\d{4}-\d{2}-\d{2}/.test(
      String(body.effectiveFrom ?? ''),
    )
      ? String(body.effectiveFrom)
      : new Date().toISOString();
    const id = `fx_${crypto.randomUUID()}`;
    await db
      .prepare(
        // Rates are historical: the pair plus its effective date is the key, so
        // setting today's rate twice corrects it rather than adding a second
        // one, and yesterday's stays where it is.
        `INSERT INTO fx_rates (id, base_currency, quote_currency, rate, effective_from, source)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(base_currency, quote_currency, effective_from)
           DO UPDATE SET rate = excluded.rate, source = excluded.source`,
      )
      .bind(
        id,
        base,
        quote,
        rate,
        effectiveFrom,
        String(body.source ?? 'manual').slice(0, 60),
      )
      .run();
    await recordAudit(auth.session, 'billing.fx_rate_set', 'fx_rate', id, {
      base,
      quote,
      rate,
      effectiveFrom,
    });
    return NextResponse.json({ ok: true, base, quote, rate, effectiveFrom });
  }

  if (body.action === 'price_book_set') {
    const productType =
      body.productType === 'credit_package' ? 'credit_package' : 'plan';
    const productId = String(body.productId ?? '').slice(0, 80);
    const currency = String(body.currency ?? '')
      .trim()
      .toUpperCase();
    const amountMinor = Number(body.amountMinor);
    if (!productId)
      return NextResponse.json(
        { error: 'Name the plan or credit package this price is for.' },
        { status: 400 },
      );
    if (!/^[A-Z]{3}$/.test(currency))
      return NextResponse.json(
        { error: 'The currency must be a three-letter code.' },
        { status: 400 },
      );
    // Minor units, so 4999 is $49.99. A fractional value here would be a
    // rounding argument on every invoice that used it.
    if (!Number.isInteger(amountMinor) || amountMinor < 0)
      return NextResponse.json(
        { error: 'The amount must be a whole number of minor units.' },
        { status: 400 },
      );
    const country = String(body.country ?? '')
      .trim()
      .toUpperCase()
      .slice(0, 2);
    const id = `price_${crypto.randomUUID()}`;
    await db
      .prepare(
        `INSERT INTO price_books
           (id, product_type, product_id, country, currency, amount_minor, active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(product_type, product_id, country, currency)
           DO UPDATE SET amount_minor = excluded.amount_minor, active = excluded.active`,
      )
      .bind(
        id,
        productType,
        productId,
        country,
        currency,
        amountMinor,
        body.active === false ? 0 : 1,
        auth.session.userId,
      )
      .run();
    await recordAudit(
      auth.session,
      'billing.price_book_set',
      'price_book',
      id,
      {
        productType,
        productId,
        country,
        currency,
        amountMinor,
      },
    );
    return NextResponse.json({ ok: true, productType, productId, currency });
  }

  if (body.action === 'kyc_status' || body.action === 'kyc_document_review') {
    return NextResponse.json({ error: 'Number verification is handled by the customer’s carrier. Call Vani no longer collects or approves number KYC.' }, { status: 410 });
  }
  if (body.action === 'ticket_reply') {
    const ticket = await db
      .prepare('SELECT id FROM support_tickets WHERE id = ?')
      .bind(body.ticketId)
      .first<{ id: string }>();
    if (!ticket || !body.message?.trim())
      return NextResponse.json(
        { error: 'Ticket and reply are required.' },
        { status: 400 },
      );
    await db.batch([
      db
        .prepare(
          `INSERT INTO support_ticket_messages (id, ticket_id, sender_role, sender_name, message) VALUES (?, ?, 'admin', ?, ?)`,
        )
        .bind(
          `ticket_message_${crypto.randomUUID()}`,
          ticket.id,
          auth.session.name,
          body.message.trim().slice(0, 4000),
        ),
      db
        .prepare(
          `UPDATE support_tickets SET status = 'waiting_on_customer', assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .bind(auth.session.name, ticket.id),
    ]);
    await recordAudit(
      auth.session,
      'ticket.replied',
      'support_ticket',
      ticket.id,
      {},
    );
    return NextResponse.json({ replied: true });
  }
  if (body.action === 'ticket_status') {
    const allowed = [
      'open',
      'in_progress',
      'waiting_on_customer',
      'resolved',
      'closed',
    ];
    if (!allowed.includes(body.status ?? ''))
      return NextResponse.json(
        { error: 'Invalid ticket status.' },
        { status: 400 },
      );
    await db
      .prepare(
        `UPDATE support_tickets SET status = ?, assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(body.status, auth.session.name, body.ticketId)
      .run();
    await recordAudit(
      auth.session,
      'ticket.status_changed',
      'support_ticket',
      body.ticketId,
      { status: body.status },
    );
    return NextResponse.json({ updated: true });
  }
  return NextResponse.json(
    { error: 'Unsupported platform action.' },
    { status: 400 },
  );
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return minimum;
  return Math.min(maximum, Math.max(minimum, parsed));
}
