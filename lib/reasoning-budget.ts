/**
 * How many tokens a reasoning call may answer in.
 *
 * This was written inline at each provider as
 * `Math.max(40, Math.min(700, asked ?? 700))`, where the ceiling and the
 * default are the same number — which makes the parameter decorative. Every
 * caller got 700 whatever it asked for, and the two that ask for more are the
 * two whose answers are not sentences:
 *
 *  - the tool-calling turn raises its budget to at least 900 on purpose, with
 *    a comment explaining that a truncated `tool_use` block came back as
 *    `stop_reason: max_tokens` with no text and dropped the turn to canned
 *    lines. `Math.max(900, …)` then met `Math.min(700, …)` one level down and
 *    lost.
 *  - the schema builder asks for 2000 and is told to propose up to four
 *    objects of twenty fields. That does not fit in 700 tokens, so the answer
 *    arrived cut off mid-JSON and was reported as a model that "did not return
 *    a schema this engine could read" — blaming the answer for the size of the
 *    envelope it was posted in.
 *
 * A ceiling is still right: an unbounded budget is an unbounded bill. It just
 * has to be above the default, or it is not a ceiling, it is a fixed size.
 */

/** What a caller gets when it does not say. Enough for a spoken reply. */
export const REASONING_DEFAULT_TOKENS = 700;
/** The real ceiling: the largest answer any caller in this product needs. */
export const REASONING_MAX_TOKENS = 2000;
/** Below this nothing useful comes back, so an accidental 0 is not honoured. */
export const REASONING_MIN_TOKENS = 40;

export function reasoningBudget(asked?: number | null): number {
  if (typeof asked !== 'number' || !Number.isFinite(asked))
    return REASONING_DEFAULT_TOKENS;
  return Math.max(
    REASONING_MIN_TOKENS,
    Math.min(REASONING_MAX_TOKENS, Math.round(asked)),
  );
}

/**
 * Whether the model stopped because it ran out of room rather than because it
 * had finished.
 *
 * Worth naming separately: a cut-off answer and a bad answer look identical
 * once parsing fails, and only one of them is the model's fault.
 */
export function ranOutOfRoom(stopReason: unknown): boolean {
  return stopReason === 'max_tokens' || stopReason === 'length';
}
