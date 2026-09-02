import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireAdmin } from '@/lib/api-session';
import { recordAudit } from '@/lib/demo-seed';
import {
  platformProviderSecret,
  providerReadiness,
} from '@/lib/provider-adapters';
import { encryptSecret } from '@/lib/security';

// Providers whose keys the admin panel may store.
// Sign-in providers whose OAuth credentials the platform admin may store.
const AUTH_PROVIDERS = new Set(['google', 'github', 'microsoft']);

const MANAGED_PROVIDERS = new Set([
  'sarvam',
  'elevenlabs',
  'anthropic',
  'openai',
  'razorpay',
  'whatsapp',
  'exotel',
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
  whatsapp: 'provider_whatsapp',
  exotel: 'provider_telephony',
};

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const db = getRawDb();
  const [authProviders, platformProviders, providerKeys, tickets, messages] =
    await Promise.all([
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
    platformProviders: platformProviderRows,
    providerKeys: providerKeys.results,
    providerReadiness: readiness,
    tickets: tickets.results,
    ticketMessages: messages.results,
  });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  await ensureSchema();
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
  };
  const db = getRawDb();

  if (body.action === 'provider_key_save') {
    const provider = String(body.provider || '');
    if (!MANAGED_PROVIDERS.has(provider))
      return NextResponse.json(
        { error: 'Unsupported provider.' },
        { status: 400 },
      );
    const config = JSON.stringify(body.config ?? {});
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (apiKey) {
      const encrypted = await encryptSecret(apiKey);
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
      { hasKey: Boolean(apiKey), config: body.config ?? {} },
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
      hasStored ||
      (provider === 'google' &&
        Boolean(
          process.env.GOOGLE_CLIENT_ID &&
            process.env.GOOGLE_CLIENT_SECRET &&
            process.env.GOOGLE_REDIRECT_URI,
        ));
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
  if (body.action === 'kyc_status') {
    if (!body.numberId || !['approved', 'rejected'].includes(body.status ?? ''))
      return NextResponse.json(
        { error: 'Number and review decision are required.' },
        { status: 400 },
      );
    const approved = body.status === 'approved';
    const review = await db
      .prepare(`SELECT n.id, n.status, n.onboarding_status,
      (SELECT count(*) FROM kyc_documents d WHERE d.phone_number_id = n.id AND d.status = 'submitted') AS submitted_documents
      FROM phone_numbers n WHERE n.id = ? LIMIT 1`)
      .bind(body.numberId)
      .first<{
        id: string;
        status: string;
        onboarding_status: string;
        submitted_documents: number;
      }>();
    if (!review)
      return NextResponse.json(
        { error: 'Number request not found.' },
        { status: 404 },
      );
    if (approved && Number(review.submitted_documents) < 1) {
      return NextResponse.json(
        {
          error:
            'At least one submitted KYC document is required before approval.',
        },
        { status: 409 },
      );
    }
    if (
      approved &&
      !['kyc_review', 'provider_review'].includes(review.status) &&
      !['kyc_review', 'provider_review'].includes(review.onboarding_status)
    ) {
      return NextResponse.json(
        {
          error:
            'Ownership and KYC review must be completed before activation.',
        },
        { status: 409 },
      );
    }
    const result = await db
      .prepare(
        `UPDATE phone_numbers SET kyc_status = ?, status = ?, onboarding_status = ? WHERE id = ?`,
      )
      .bind(
        body.status,
        approved ? 'active' : 'kyc_rejected',
        approved ? 'active' : 'changes_required',
        body.numberId,
      )
      .run();
    if (!result.meta.changes)
      return NextResponse.json(
        { error: 'Number request was not updated.' },
        { status: 409 },
      );
    await db
      .prepare(
        `UPDATE kyc_documents SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE phone_number_id = ?`,
      )
      .bind(
        body.status,
        approved
          ? null
          : body.rejectionReason?.trim().slice(0, 300) ||
              'Please resubmit the requested business evidence.',
        auth.session.userId,
        body.numberId,
      )
      .run();
    await recordAudit(
      auth.session,
      `kyc.${body.status}`,
      'phone_number',
      body.numberId,
    );
    return NextResponse.json({ updated: true });
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
    await recordAudit(auth.session, 'ticket.replied', 'support_ticket', ticket.id, {});
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
