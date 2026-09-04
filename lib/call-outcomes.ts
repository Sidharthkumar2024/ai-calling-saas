/**
 * One vocabulary for how a call ended (§17, §28).
 *
 * `call_records` has both a `status` (where the call is in its lifecycle) and
 * an `outcome` (what the conversation achieved), and writers had been putting
 * lifecycle values into the outcome column: `in_progress`, `dialing`,
 * `completed`, `abandoned`. On top of that the post-call intelligence job wrote
 * a second, different set. Two screens then each counted conversions using a
 * different guess at the vocabulary:
 *
 *   analytics → payment_link_sent, resolved
 *   overview  → payment_link_requested, converted
 *
 * `converted` is a *lead* stage and is never written to a call at all, and
 * `payment_link_requested` exists only on a demo seed row — so the two screens
 * reported different conversion counts for the same calls, and one of them was
 * counting demo data.
 *
 * Everything that reads or writes a call outcome now shares this module.
 */

/** What a finished conversation achieved. Written by the intelligence job. */
export const CALL_OUTCOMES = [
  'resolved',
  'information_provided',
  'appointment_booked',
  'payment_link_sent',
  'callback_scheduled',
  'transferred_to_human',
  'not_interested',
  'incomplete',
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/**
 * A call that has not been analysed yet has no outcome. It is recorded as
 * `unknown` rather than borrowed from the lifecycle, so "we don't know" is
 * never counted as "nothing happened".
 */
export const UNKNOWN_OUTCOME = 'unknown';

/** The outcomes that count as a conversion, for every screen that counts them. */
export const CONVERSION_OUTCOMES: CallOutcome[] = [
  'appointment_booked',
  'payment_link_sent',
  'resolved',
];

export function isCallOutcome(value: unknown): value is CallOutcome {
  return (
    typeof value === 'string' &&
    (CALL_OUTCOMES as readonly string[]).includes(value)
  );
}

/**
 * Legacy and lifecycle values, mapped onto the vocabulary. Used both by the
 * one-time migration and by any writer handling older data.
 *
 * Note what is *not* mapped: `payment_link_requested` does not become
 * `payment_link_sent`. Requesting a link and sending one are different facts,
 * and promoting one to the other would inflate the conversion count — which is
 * exactly the bug this module exists to fix.
 */
const LEGACY: Record<string, CallOutcome | typeof UNKNOWN_OUTCOME> = {
  // Lifecycle values that belong in `status`, not `outcome`.
  completed: UNKNOWN_OUTCOME,
  in_progress: UNKNOWN_OUTCOME,
  dialing: UNKNOWN_OUTCOME,
  enqueue: UNKNOWN_OUTCOME,
  qualifying: UNKNOWN_OUTCOME,
  abandoned: 'incomplete',
  // Older names for outcomes that still exist.
  callback: 'callback_scheduled',
  callback_requested: 'callback_scheduled',
  transferred: 'transferred_to_human',
  payment_link_requested: UNKNOWN_OUTCOME,
  converted: 'resolved',
};

/**
 * Maps any stored value onto the vocabulary. Free prose — the intelligence job
 * once wrote whole sentences here — becomes `incomplete`, because a call the
 * model could only describe in a sentence did not reach a clean outcome.
 */
export function normaliseOutcome(
  value: unknown,
): CallOutcome | typeof UNKNOWN_OUTCOME {
  if (typeof value !== 'string' || !value.trim()) return UNKNOWN_OUTCOME;
  const text = value.trim().toLowerCase();
  if (isCallOutcome(text)) return text;
  if (text in LEGACY) return LEGACY[text];
  // Anything else was free text rather than a recorded outcome.
  return 'incomplete';
}

/** `IN (...)` fragment for the conversion set, so both screens agree by construction. */
export const CONVERSION_SQL_LIST = CONVERSION_OUTCOMES.map(
  (outcome) => `'${outcome}'`,
).join(',');
