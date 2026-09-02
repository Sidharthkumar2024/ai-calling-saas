import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { listVoiceProfiles } from '@/lib/voice-profiles';

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

export async function POST(request: Request) {
  const auth = await requireCustomer(request);
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
  return NextResponse.json({ created: true, id });
}

export async function PATCH(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = (await request.json()) as {
    action?: 'update' | 'bind_agent';
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
        `SELECT id FROM voice_profiles WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(body.profileId, auth.session.organizationId)
      .first<{ id: string }>();
    if (!owned)
      return NextResponse.json(
        { error: 'Voice profile not found.' },
        { status: 404 },
      );
    const result = await db
      .prepare(
        `UPDATE voice_agents SET voice_profile_id = ? WHERE id = ? AND organization_id = ?`,
      )
      .bind(body.profileId, body.agentId, auth.session.organizationId)
      .run();
    if (!result.meta.changes)
      return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
    return NextResponse.json({ bound: true });
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
  return NextResponse.json({ updated: true });
}
