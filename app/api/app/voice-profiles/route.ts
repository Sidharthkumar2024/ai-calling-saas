import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import { listVoiceProfiles } from '@/lib/voice-profiles';
import { validateConsent, voiceGate } from '@/lib/voice-consent';

export const dynamic = 'force-dynamic';

const PRESENTATIONS = new Set(['female', 'male']);
const PROVIDERS = new Set(['elevenlabs', 'sarvam']);
const RATES = new Set(['slow', 'normal', 'fast']);

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const profiles = await listVoiceProfiles(auth.session.organizationId!);
  const agents = await getRawDb()
    .prepare(
      `SELECT id, name, voice_profile_id FROM voice_agents WHERE organization_id = ? ORDER BY name`,
    )
    .bind(auth.session.organizationId)
    .all<{ id: string; name: string; voice_profile_id: string | null }>();
  return NextResponse.json({ profiles, agents: agents.results ?? [] });
}

// Which voice an agent speaks with is an agent configuration change, and §32
// requires it to be attributable: creating or rebinding a voice was previously
// open to every workspace member and left no audit trail at all.
export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'agents.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = (await request.json()) as {
    name?: string;
    presentation?: string;
    provider?: string;
    providerVoiceId?: string;
    modelId?: string;
    defaultLanguage?: string;
    allowedLanguages?: string[];
    autoLanguageSwitch?: boolean;
    accentProfile?: string;
    speakingRate?: string;
    style?: string;
    providerPolicy?: string;
    voiceLock?: boolean;
    fallbackProfileId?: string;
  };
  const name = body.name?.trim();
  if (!name)
    return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  const presentation = PRESENTATIONS.has(body.presentation ?? '')
    ? body.presentation!
    : 'female';
  const provider = PROVIDERS.has(body.provider ?? '')
    ? body.provider!
    : 'elevenlabs';
  const speakingRate = RATES.has(body.speakingRate ?? '')
    ? body.speakingRate!
    : 'normal';
  const id = `voice_${crypto.randomUUID()}`;
  await getRawDb()
    .prepare(`INSERT INTO voice_profiles
      (id, organization_id, name, presentation, provider, provider_voice_id, model_id,
       default_language, allowed_languages_json, auto_language_switch, accent_profile,
       speaking_rate, style, provider_policy, voice_lock, fallback_profile_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      auth.session.organizationId,
      name,
      presentation,
      provider,
      body.providerVoiceId?.trim() || null,
      body.modelId?.trim() || null,
      body.defaultLanguage?.trim() || 'hi-IN',
      JSON.stringify(
        Array.isArray(body.allowedLanguages) && body.allowedLanguages.length
          ? body.allowedLanguages
          : ['hi-IN', 'en-IN', 'hinglish'],
      ),
      body.autoLanguageSwitch === false ? 0 : 1,
      body.accentProfile?.trim() || 'indian_neutral',
      speakingRate,
      body.style?.trim() || 'warm',
      body.providerPolicy?.trim() || 'elevenlabs_first',
      body.voiceLock ? 1 : 0,
      body.fallbackProfileId?.trim() || null,
    )
    .run();
  await recordAudit(auth.session, 'voice_profile.created', 'voice_profile', id);
  return NextResponse.json({ created: true, id });
}

export async function PATCH(request: Request) {
  const auth = await requireCustomerPermission(request, 'agents.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = (await request.json()) as {
    action?: 'update' | 'bind_agent' | 'submit_consent' | 'withdraw_consent';
    profileId?: string;
    agentId?: string;
    voiceLock?: boolean;
    allowedLanguages?: string[];
    speakingRate?: string;
    style?: string;
    providerVoiceId?: string;
    modelId?: string;
    fallbackProfileId?: string;
    autoLanguageSwitch?: boolean;
    speakerName?: string;
    relationship?: string;
    statement?: string;
    evidenceKey?: string;
  };
  const db = getRawDb();

  if (body.action === 'bind_agent') {
    if (!body.agentId || !body.profileId)
      return NextResponse.json(
        { error: 'agentId and profileId are required.' },
        { status: 400 },
      );
    const owned = await db
      .prepare(
        `SELECT p.id, coalesce(p.kind,'prebuilt') AS kind, p.status,
           coalesce(p.platform_blocked, 0) AS platform_blocked,
           p.removal_notice_at,
           c.state AS consent_state, c.relationship, c.evidence_key, c.verified_by,
           c.withdrawn_at
         FROM voice_profiles p
         LEFT JOIN voice_consents c ON c.voice_profile_id = p.id
         WHERE p.id = ? AND p.organization_id = ? LIMIT 1`,
      )
      .bind(body.profileId, auth.session.organizationId)
      .first<{
        id: string;
        kind: string;
        status: string;
        platform_blocked: number;
        removal_notice_at: string | null;
        consent_state: string | null;
        relationship: string | null;
        evidence_key: string | null;
        verified_by: string | null;
        withdrawn_at: string | null;
      }>();
    if (!owned)
      return NextResponse.json(
        { error: 'Voice profile not found.' },
        { status: 404 },
      );
    // §32: no unauthorised impersonation. A custom voice cannot be bound to an
    // agent until a platform reviewer has verified the consent evidence — not
    // "unless someone objects", and not "pending is close enough".
    const gate = voiceGate({
      kind: owned.kind === 'custom' ? 'custom' : 'prebuilt',
      status: owned.status,
      platformBlocked: owned.platform_blocked === 1,
      providerDisabled: Boolean(owned.removal_notice_at),
      consent: owned.consent_state
        ? {
            state: owned.consent_state as never,
            evidenceKey: owned.evidence_key,
            verifiedBy: owned.verified_by,
            withdrawnAt: owned.withdrawn_at,
          }
        : null,
    });
    if (!gate.allowed)
      return NextResponse.json(
        { error: gate.reason, code: gate.code },
        { status: 409 },
      );
    const result = await db
      .prepare(
        `UPDATE voice_agents SET voice_profile_id = ? WHERE id = ? AND organization_id = ?`,
      )
      .bind(body.profileId, body.agentId, auth.session.organizationId)
      .run();
    if (!result.meta.changes)
      return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
    await recordAudit(
      auth.session,
      'voice_profile.bound_to_agent',
      'voice_agent',
      String(body.agentId),
      { profileId: body.profileId },
    );
    return NextResponse.json({ bound: true });
  }

  if (body.action === 'submit_consent') {
    const owned = await db
      .prepare(
        `SELECT id FROM voice_profiles WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(body.profileId ?? '', auth.session.organizationId)
      .first<{ id: string }>();
    if (!owned)
      return NextResponse.json(
        { error: 'Voice profile not found.' },
        { status: 404 },
      );
    const consent = validateConsent({
      speakerName: body.speakerName,
      relationship: body.relationship,
      statement: body.statement,
      evidenceKey: body.evidenceKey,
    });
    if (!consent.ok)
      return NextResponse.json(
        {
          error: 'This consent record is not complete.',
          problems: consent.errors,
        },
        { status: 400 },
      );
    await db
      .prepare(
        `INSERT INTO voice_consents
          (id, organization_id, voice_profile_id, speaker_name, relationship,
           statement, evidence_key, state, submitted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
         ON CONFLICT(voice_profile_id) DO UPDATE SET
           speaker_name = excluded.speaker_name,
           relationship = excluded.relationship,
           statement = excluded.statement,
           evidence_key = excluded.evidence_key,
           /* Resubmitting restarts the review. A workspace must not be able to
              edit an already-verified consent into something else. */
           state = 'pending', verified_by = NULL, verified_at = NULL,
           /* And the last reviewer's complaint. Leaving it attached to a fresh
              submission shows somebody who fixed exactly what was asked the
              old objection sitting under "waiting for review". */
           review_note = NULL,
           withdrawn_at = NULL, submitted_by = excluded.submitted_by`,
      )
      .bind(
        `voiceconsent_${crypto.randomUUID()}`,
        auth.session.organizationId,
        body.profileId,
        consent.speakerName,
        consent.relationship,
        consent.statement,
        consent.evidenceKey,
        auth.session.userId,
      )
      .run();
    await db
      .prepare(
        `UPDATE voice_profiles SET kind = 'custom' WHERE id = ? AND organization_id = ?`,
      )
      .bind(body.profileId, auth.session.organizationId)
      .run();
    await recordAudit(
      auth.session,
      'voice_consent.submitted',
      'voice_profile',
      String(body.profileId),
      { speaker: consent.speakerName, relationship: consent.relationship },
    );
    return NextResponse.json({
      submitted: true,
      state: 'pending',
      note: 'A platform reviewer checks the evidence before this voice can be used.',
    });
  }

  if (body.action === 'withdraw_consent') {
    const result = await db
      .prepare(
        `UPDATE voice_consents SET state = 'withdrawn', withdrawn_at = CURRENT_TIMESTAMP
         WHERE voice_profile_id = ? AND organization_id = ? AND state != 'withdrawn'`,
      )
      .bind(body.profileId ?? '', auth.session.organizationId)
      .run();
    if (!result.meta.changes)
      return NextResponse.json(
        { error: 'No active consent to withdraw.' },
        { status: 404 },
      );
    // Unbinding is the point: withdrawing consent on a voice that is still
    // speaking on live agents would change a row and nothing else.
    const unbound = await db
      .prepare(
        `UPDATE voice_agents SET voice_profile_id = NULL
         WHERE voice_profile_id = ? AND organization_id = ?`,
      )
      .bind(body.profileId ?? '', auth.session.organizationId)
      .run();
    await recordAudit(
      auth.session,
      'voice_consent.withdrawn',
      'voice_profile',
      String(body.profileId),
      { agentsUnbound: unbound.meta.changes ?? 0 },
    );
    return NextResponse.json({
      withdrawn: true,
      agentsUnbound: unbound.meta.changes ?? 0,
    });
  }

  if (!body.profileId)
    return NextResponse.json(
      { error: 'profileId is required.' },
      { status: 400 },
    );
  const updates: string[] = [];
  const values: unknown[] = [];
  if (typeof body.voiceLock === 'boolean') {
    updates.push('voice_lock = ?');
    values.push(body.voiceLock ? 1 : 0);
  }
  if (typeof body.autoLanguageSwitch === 'boolean') {
    updates.push('auto_language_switch = ?');
    values.push(body.autoLanguageSwitch ? 1 : 0);
  }
  if (Array.isArray(body.allowedLanguages)) {
    updates.push('allowed_languages_json = ?');
    values.push(JSON.stringify(body.allowedLanguages));
  }
  if (RATES.has(body.speakingRate ?? '')) {
    updates.push('speaking_rate = ?');
    values.push(body.speakingRate);
  }
  if (body.style?.trim()) {
    updates.push('style = ?');
    values.push(body.style.trim());
  }
  if (typeof body.providerVoiceId === 'string') {
    updates.push('provider_voice_id = ?');
    values.push(body.providerVoiceId.trim() || null);
  }
  if (typeof body.modelId === 'string') {
    updates.push('model_id = ?');
    values.push(body.modelId.trim() || null);
  }
  if (typeof body.fallbackProfileId === 'string') {
    updates.push('fallback_profile_id = ?');
    values.push(body.fallbackProfileId.trim() || null);
  }
  if (!updates.length)
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  const result = await db
    .prepare(
      `UPDATE voice_profiles SET ${updates.join(', ')} WHERE id = ? AND organization_id = ?`,
    )
    .bind(...values, body.profileId, auth.session.organizationId)
    .run();
  if (!result.meta.changes)
    return NextResponse.json(
      { error: 'Voice profile not found.' },
      { status: 404 },
    );
  await recordAudit(
    auth.session,
    'voice_profile.updated',
    'voice_profile',
    String(body.profileId),
  );
  return NextResponse.json({ updated: true });
}
