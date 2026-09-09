import { getRawDb } from '@/db/index';

export type VoiceProfileRow = {
  removal_notice_at?: string | null;
  removal_reason?: string | null;
  id: string;
  name: string;
  presentation: string;
  provider: string;
  provider_voice_id: string | null;
  model_id: string | null;
  default_language: string;
  allowed_languages_json: string;
  auto_language_switch: number;
  accent_profile: string;
  speaking_rate: string;
  style: string;
  provider_policy: string;
  voice_lock: number;
  fallback_profile_id: string | null;
  status: string;
};

export type ResolvedVoice = {
  profileId: string;
  profileName: string;
  presentation: string;
  provider: string;
  voiceId: string | null;
  modelId: string | null;
  speakingRate: string;
  style: string;
  voiceLocked: boolean;
  languageSupported: boolean;
  /** Set when the language forced a switch to the same-presentation fallback. */
  switchedFromProfileId?: string;
};

function parseLanguages(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

async function loadProfile(organizationId: string, profileId: string) {
  return getRawDb()
    .prepare(
      `SELECT * FROM voice_profiles WHERE id = ? AND organization_id = ? AND status = 'active' LIMIT 1`,
    )
    .bind(profileId, organizationId)
    .first<VoiceProfileRow>();
}

/**
 * Voice continuity (PDF §4): keep the approved voice when the language changes.
 * If the profile does not cover the target language, fall back to the configured
 * same-presentation profile — unless the voice is locked, in which case the
 * locked voice is kept regardless.
 */
export async function resolveAgentVoice(input: {
  organizationId: string;
  agentId?: string | null;
  languageCode: string;
}): Promise<ResolvedVoice | null> {
  if (!input.agentId) return null;
  let profile: VoiceProfileRow | null = null;
  try {
    const agent = await getRawDb()
      .prepare(
        `SELECT voice_profile_id FROM voice_agents WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(input.agentId, input.organizationId)
      .first<{ voice_profile_id: string | null }>();
    if (!agent?.voice_profile_id) return null;
    profile = await loadProfile(input.organizationId, agent.voice_profile_id);
  } catch {
    return null;
  }
  if (!profile) return null;

  const allowed = parseLanguages(profile.allowed_languages_json);
  const supported =
    allowed.length === 0 || allowed.includes(input.languageCode);
  const locked = Boolean(profile.voice_lock);

  if (!supported && !locked && profile.fallback_profile_id) {
    const fallback = await loadProfile(
      input.organizationId,
      profile.fallback_profile_id,
    );
    // Only accept a fallback that keeps the same presentation.
    if (fallback && fallback.presentation === profile.presentation) {
      return {
        profileId: fallback.id,
        profileName: fallback.name,
        presentation: fallback.presentation,
        provider: fallback.provider,
        voiceId: fallback.provider_voice_id,
        modelId: fallback.model_id,
        speakingRate: fallback.speaking_rate,
        style: fallback.style,
        voiceLocked: Boolean(fallback.voice_lock),
        languageSupported: parseLanguages(
          fallback.allowed_languages_json,
        ).includes(input.languageCode),
        switchedFromProfileId: profile.id,
      };
    }
  }

  return {
    profileId: profile.id,
    profileName: profile.name,
    presentation: profile.presentation,
    provider: profile.provider,
    voiceId: profile.provider_voice_id,
    modelId: profile.model_id,
    speakingRate: profile.speaking_rate,
    style: profile.style,
    voiceLocked: locked,
    languageSupported: supported,
  };
}

export async function listVoiceProfiles(organizationId: string) {
  // Consent comes back with the profile. Without it the screen could not say
  // whether a cloned voice had anybody's permission, which is why submitting
  // and withdrawing that permission were capabilities the API handled and no
  // screen could reach.
  const rows = await getRawDb()
    .prepare(
      `SELECT p.*, c.state AS consent_state, c.speaker_name AS consent_speaker,
         c.relationship AS consent_relationship, c.verified_at AS consent_verified_at,
         c.withdrawn_at AS consent_withdrawn_at
       FROM voice_profiles p
       LEFT JOIN voice_consents c ON c.voice_profile_id = p.id
       WHERE p.organization_id = ? ORDER BY p.presentation, p.name`,
    )
    .bind(organizationId)
    .all<
      VoiceProfileRow & {
        consent_state: string | null;
        consent_speaker: string | null;
        consent_relationship: string | null;
        consent_verified_at: string | null;
        consent_withdrawn_at: string | null;
      }
    >();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    presentation: row.presentation,
    provider: row.provider,
    hasVoiceId: Boolean(row.provider_voice_id),
    // Set when the provider tells us this voice is going away; the agents
    // bound to it stop speaking once it does.
    removalNoticeAt: row.removal_notice_at ?? null,
    removalReason: row.removal_reason ?? null,
    modelId: row.model_id,
    defaultLanguage: row.default_language,
    allowedLanguages: parseLanguages(row.allowed_languages_json),
    autoLanguageSwitch: Boolean(row.auto_language_switch),
    accentProfile: row.accent_profile,
    speakingRate: row.speaking_rate,
    style: row.style,
    providerPolicy: row.provider_policy,
    voiceLock: Boolean(row.voice_lock),
    fallbackProfileId: row.fallback_profile_id,
    status: row.status,
    kind: (row as { kind?: string }).kind ?? 'prebuilt',
    consent: row.consent_state
      ? {
          state: row.consent_state,
          speakerName: row.consent_speaker,
          relationship: row.consent_relationship,
          verifiedAt: row.consent_verified_at,
          withdrawnAt: row.consent_withdrawn_at,
        }
      : null,
  }));
}
