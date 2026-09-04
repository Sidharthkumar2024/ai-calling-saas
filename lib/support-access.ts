/**
 * Audited support access (§30).
 *
 * A support executive can open a view into a customer's workspace — but only
 * after that customer hands over a PIN they generated themselves, and only for
 * a bounded time, and only over data that is on an explicit list.
 *
 * The shape matters more than the code. Three rules, each answering a way this
 * goes wrong in practice:
 *
 *  - **The customer grants it, not the operator.** A PIN is minted inside the
 *    workspace by someone who works there. Support cannot let itself in.
 *  - **It ends by itself.** A session that needs a human to remember to close
 *    it is a session that stays open. Both the PIN and the session expire on a
 *    clock, and the PIN is single-use.
 *  - **Exposure is a list, not a filter.** `VISIBLE_FIELDS` names what support
 *    may read. Anything not named is invisible, so a column added next year is
 *    private until somebody decides otherwise — the opposite of a deny-list,
 *    which leaks by default the moment the schema grows.
 *
 * Pure: the clock is an argument, so every expiry rule is testable.
 */

/** No I/O/0/1 — a PIN is read aloud over a phone line. */
const PIN_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679';

export const PIN_TTL_MS = 30 * 60 * 1000;
export const SESSION_TTL_MS = 60 * 60 * 1000;
export const MAX_PIN_ATTEMPTS = 5;

/**
 * A PIN the customer reads out. Grouped for dictation, and drawn from a
 * confusion-free alphabet because it will be spoken, not pasted.
 */
export function generatePin(random: () => number = Math.random) {
  let raw = '';
  for (let index = 0; index < 8; index += 1)
    raw += PIN_ALPHABET[Math.floor(random() * PIN_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** Comparison form: case and grouping should not decide whether a PIN works. */
export function normalisePin(value: unknown) {
  // A PIN is typed or read out, so only a string is one. Stringifying anything
  // else would turn a malformed request into a comparable value.
  if (typeof value !== 'string') return '';
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export type PinRow = {
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  attempts: number;
};

export type PinState = 'valid' | 'expired' | 'used' | 'revoked' | 'locked';

export function pinState(row: PinRow | null, now: Date = new Date()): PinState {
  if (!row) return 'revoked';
  if (row.revoked_at) return 'revoked';
  if (row.used_at) return 'used';
  // Attempt-locking comes before expiry so a brute-force attempt is reported as
  // what it is rather than aging out quietly.
  if (Number(row.attempts ?? 0) >= MAX_PIN_ATTEMPTS) return 'locked';
  const expiry = Date.parse(row.expires_at);
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) return 'expired';
  return 'valid';
}

export function pinMessage(state: PinState): string {
  switch (state) {
    case 'valid':
      return 'PIN accepted.';
    case 'expired':
      return 'That PIN has expired. Ask the customer to generate a new one.';
    case 'used':
      return 'That PIN has already been used. Ask the customer for a new one.';
    case 'locked':
      return 'That PIN is locked after too many attempts.';
    case 'revoked':
      return 'That PIN is not valid.';
  }
}

export type SessionRow = {
  expires_at: string;
  ended_at: string | null;
};

export type SessionState = 'active' | 'expired' | 'ended';

export function sessionState(
  row: SessionRow | null,
  now: Date = new Date(),
): SessionState {
  if (!row) return 'ended';
  if (row.ended_at) return 'ended';
  const expiry = Date.parse(row.expires_at);
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) return 'expired';
  return 'active';
}

/**
 * What a support session may read, by area.
 *
 * An allow-list on purpose. The alternative — redacting known-sensitive fields —
 * is wrong the moment somebody adds a column, because the new one is exposed
 * until it is noticed. §30 says "do not expose secrets by default"; this is what
 * "by default" has to mean to be true a year from now.
 */
export const VISIBLE_FIELDS = {
  workspace: ['id', 'name', 'slug', 'status', 'created_at', 'currency'],
  subscription: ['plan_name', 'plan_code', 'status', 'current_period_end'],
  wallet: ['balance', 'low_balance_threshold'],
  diagnostics: [
    'support_code',
    'readiness',
    'quality_band',
    'rtt_ms',
    'browser',
    'created_at',
  ],
  errors: ['type', 'status', 'last_error', 'created_at'],
  tickets: ['id', 'subject', 'status', 'priority', 'created_at', 'updated_at'],
  calls: ['id', 'status', 'outcome', 'duration_seconds', 'started_at'],
} as const;

export type SupportArea = keyof typeof VISIBLE_FIELDS;

/**
 * Strips a row to the fields support may see.
 *
 * Returns a new object rather than deleting keys, so a field nobody listed
 * cannot survive by being added after the filter runs.
 */
export function project<T extends Record<string, unknown>>(
  area: SupportArea,
  row: T,
): Record<string, unknown> {
  const allowed = VISIBLE_FIELDS[area] as readonly string[];
  const output: Record<string, unknown> = {};
  for (const field of allowed) if (field in row) output[field] = row[field];
  return output;
}

/**
 * Fields that must never appear, whatever an allow-list says.
 *
 * Belt as well as braces: if somebody adds `api_key` to a visible list by
 * mistake, this catches it. It is a second line, not the first — the allow-list
 * above is what actually keeps things private.
 */
const NEVER =
  /secret|token|password|api_key|apikey|credential|hash|pin|private/i;

export function containsForbiddenField(row: Record<string, unknown>) {
  return Object.keys(row).filter((key) => NEVER.test(key));
}
