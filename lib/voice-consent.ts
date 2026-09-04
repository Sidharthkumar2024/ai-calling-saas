/**
 * Voice Studio consent (§32).
 *
 * A custom voice is somebody's voice. §32 asks for explicit consent,
 * verification, per-agent authorisation, audit and a Super Admin kill switch,
 * and the sentence that matters is the last one: **no unauthorised
 * impersonation.**
 *
 * So the rule here is deliberately one-directional. A *prebuilt* voice from a
 * provider's own library needs nothing — the provider licensed it. A **custom**
 * voice cannot be used by anything until a human at the platform has looked at
 * the consent evidence and marked it verified. Not "unless someone objects";
 * not "pending is close enough". Uploading a recording of a voice is exactly
 * the action that needs a person in the loop, because the person whose voice it
 * is cannot be the one clicking the button.
 *
 * Pure: states and rules only, so the gate is the same in a test and on a call.
 */

export const VOICE_KINDS = ['prebuilt', 'custom'] as const;
export type VoiceKind = (typeof VOICE_KINDS)[number];

export const CONSENT_STATES = [
  'not_required',
  'pending',
  'verified',
  'rejected',
  'withdrawn',
] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

/** How the workspace came by the voice. Recorded because it changes the risk. */
export const CONSENT_RELATIONSHIPS = [
  'self',
  'employee',
  'licensed',
  'synthetic',
] as const;
export type ConsentRelationship = (typeof CONSENT_RELATIONSHIPS)[number];

export function isConsentRelationship(
  value: unknown,
): value is ConsentRelationship {
  return (
    typeof value === 'string' &&
    (CONSENT_RELATIONSHIPS as readonly string[]).includes(value)
  );
}

export type ConsentRecord = {
  state: ConsentState;
  relationship?: ConsentRelationship | null;
  speakerName?: string | null;
  /** A stored recording or signed document. */
  evidenceKey?: string | null;
  verifiedBy?: string | null;
  withdrawnAt?: string | null;
};

export type VoiceProfileFacts = {
  kind: VoiceKind;
  status: string;
  /** Set by a platform admin; §32's kill switch. */
  platformBlocked?: boolean;
  /** The provider itself disabled or removed the voice. */
  providerDisabled?: boolean;
  consent?: ConsentRecord | null;
};

export type VoiceGate =
  | { allowed: true; kind: VoiceKind }
  | { allowed: false; reason: string; code: string };

/**
 * Whether this voice may be bound to an agent or spoken on a call.
 *
 * Ordered so the most absolute reason wins: a platform block is a decision
 * about the voice itself and outranks anything the workspace has arranged.
 */
export function voiceGate(profile: VoiceProfileFacts): VoiceGate {
  if (profile.platformBlocked)
    return {
      allowed: false,
      code: 'platform_blocked',
      reason:
        'A platform administrator has disabled this voice. It cannot be used until that is lifted.',
    };
  if (profile.providerDisabled)
    return {
      allowed: false,
      code: 'provider_disabled',
      reason:
        'The provider has removed or disabled this voice, so it can no longer be synthesised.',
    };
  if (profile.status === 'archived' || profile.status === 'disabled')
    return {
      allowed: false,
      code: 'profile_disabled',
      reason: 'This voice profile is disabled in your workspace.',
    };

  if (profile.kind !== 'custom') return { allowed: true, kind: profile.kind };

  const consent = profile.consent;
  // A custom voice with no consent record at all is the dangerous case, and it
  // is refused for the same reason as an unverified one — absence of evidence
  // is not evidence of permission.
  if (!consent || consent.state === 'not_required')
    return {
      allowed: false,
      code: 'consent_missing',
      reason:
        'A custom voice needs a recorded consent from the person it belongs to before it can be used.',
    };
  if (consent.state === 'withdrawn')
    return {
      allowed: false,
      code: 'consent_withdrawn',
      reason:
        'Consent for this voice has been withdrawn. It cannot be used again unless new consent is verified.',
    };
  if (consent.state === 'rejected')
    return {
      allowed: false,
      code: 'consent_rejected',
      reason:
        'The consent evidence for this voice was reviewed and rejected.',
    };
  if (consent.state === 'pending')
    return {
      allowed: false,
      code: 'consent_pending',
      reason:
        'This voice is waiting for a platform review of its consent evidence. It cannot be used yet.',
    };
  // Verified — but verified by whom, and on the strength of what?
  if (!consent.verifiedBy)
    return {
      allowed: false,
      code: 'consent_unattributed',
      reason:
        'This consent is marked verified but records nobody who verified it, so it is not trusted.',
    };
  if (!consent.evidenceKey)
    return {
      allowed: false,
      code: 'consent_unevidenced',
      reason:
        'This consent has no stored evidence, so there is nothing to have verified.',
    };
  return { allowed: true, kind: 'custom' };
}

/** What a workspace must supply before a custom voice can even be reviewed. */
export type ConsentSubmission = {
  speakerName?: unknown;
  relationship?: unknown;
  statement?: unknown;
  evidenceKey?: unknown;
};

export type ConsentValidation =
  | {
      ok: true;
      speakerName: string;
      relationship: ConsentRelationship;
      statement: string;
      evidenceKey: string;
    }
  | { ok: false; errors: string[] };

export function validateConsent(
  input: ConsentSubmission,
): ConsentValidation {
  const errors: string[] = [];
  const text = (value: unknown) =>
    typeof value === 'string' ? value.trim() : '';
  const speakerName = text(input.speakerName).slice(0, 120);
  const statement = text(input.statement).slice(0, 2000);
  const evidenceKey = text(input.evidenceKey).slice(0, 300);

  if (speakerName.length < 2)
    errors.push('Name the person whose voice this is.');
  if (!isConsentRelationship(input.relationship))
    errors.push(
      `Say how you came by this voice: ${CONSENT_RELATIONSHIPS.join(', ')}.`,
    );
  // A statement long enough to actually say something. A checkbox is not a
  // consent record, and this is the artefact a reviewer reads.
  if (statement.length < 40)
    errors.push(
      'Record what the person agreed to, in their words or a signed statement.',
    );
  if (!evidenceKey)
    errors.push('Attach the recording or signed document you are relying on.');

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    speakerName,
    relationship: input.relationship as ConsentRelationship,
    statement,
    evidenceKey,
  };
}
