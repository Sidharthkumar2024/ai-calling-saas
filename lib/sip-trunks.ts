/**
 * How far a SIP trunk has actually got.
 *
 * The screen says "Register trunk" and moves a trunk from
 * `configuration_saved` to `provider_test_pending`, which reads like progress
 * towards carrying calls. It is not. Nothing in this codebase sets a trunk
 * active, nothing places a call through one, and `services/media-gateway` does
 * not speak SIP at all — it terminates a carrier's media WebSocket. So a trunk
 * is a stored, encrypted configuration and, today, nothing more.
 *
 * That is a real limit, not a defect to paper over. What *was* a defect is a
 * status vocabulary that implied otherwise. These rules say what is configured,
 * what is checked, and — plainly — what is still missing before a call can
 * cross it.
 */

export const TRUNK_STATUSES = [
  'security_review_required',
  'configuration_saved',
  'provider_test_pending',
] as const;

export type TrunkStatus = (typeof TRUNK_STATUSES)[number];

export function isTrunkStatus(value: unknown): value is TrunkStatus {
  return (TRUNK_STATUSES as readonly string[]).includes(String(value));
}

/** Anything unrecognised is treated as the least-progressed state. */
export function normaliseTrunkStatus(value: unknown): TrunkStatus {
  const status = typeof value === 'string' ? value : '';
  return isTrunkStatus(status) ? status : 'security_review_required';
}

export const SUPPORTED_CODECS = ['PCMU', 'PCMA', 'OPUS', 'G722'] as const;

export type TrunkRow = {
  status: string;
  transport: string;
  media_encryption: string;
  auth_type: string;
  encrypted_credentials?: string | null;
  codecs_json?: string | null;
  last_checked_at?: string | null;
};

export type TrunkReadiness = {
  /** Everything this product can check has been checked. */
  configured: boolean;
  /** Whether a call could cross it today. Always false, and it says why. */
  carriesCalls: false;
  /** What the customer must fix, in their own control. */
  blockers: string[];
  /** What is outside their control, named rather than left silent. */
  waitingOn: string[];
  summary: string;
};

function codecList(json: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(String(json ?? '[]')) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * What stands between this trunk and a call.
 *
 * `blockers` are the customer's to fix; `waitingOn` is ours and the carrier's.
 * Keeping them apart is the point — a customer who has done everything right
 * should not be shown a list that looks like homework.
 */
export function trunkReadiness(trunk: TrunkRow): TrunkReadiness {
  const blockers: string[] = [];

  if (trunk.transport !== 'tls')
    blockers.push('Transport must be TLS before any provider test.');
  if (trunk.media_encryption === 'none')
    blockers.push('Media encryption must be SRTP (SDES or DTLS), not none.');
  if (trunk.auth_type === 'userpass' && !trunk.encrypted_credentials)
    blockers.push('SIP username and password are missing.');

  const codecs = codecList(trunk.codecs_json).filter((codec) =>
    (SUPPORTED_CODECS as readonly string[]).includes(codec),
  );
  if (codecs.length === 0)
    blockers.push('At least one supported codec is required.');

  if (normaliseTrunkStatus(trunk.status) !== 'provider_test_pending')
    blockers.push('Run the configuration check.');

  // Stated every time, not only when something is wrong: this is the part a
  // customer cannot work out from the screen and would otherwise wait on.
  const waitingOn = [
    'A SIP-capable media plane. Vaani terminates a carrier media stream today and does not register against a SIP gateway, so nothing here places a call yet.',
    'A carrier account and a two-way audio test on your own gateway.',
  ];

  const configured = blockers.length === 0;
  return {
    configured,
    carriesCalls: false,
    blockers,
    waitingOn,
    summary: configured
      ? 'Configuration saved and checked. It cannot carry calls yet — that needs a SIP-capable media plane, which this build does not have.'
      : `${blockers.length} ${blockers.length === 1 ? 'thing' : 'things'} to fix before the configuration check passes.`,
  };
}

/** One line for the card, honest about the ceiling. */
export function describeTrunkStatus(status: string): string {
  switch (normaliseTrunkStatus(status)) {
    case 'provider_test_pending':
      return 'Checked — waiting on a SIP media plane';
    case 'configuration_saved':
      return 'Saved — not checked yet';
    default:
      return 'Needs TLS and SRTP';
  }
}
