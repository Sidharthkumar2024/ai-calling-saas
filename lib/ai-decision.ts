/**
 * Deciding which way a graph should go, from what the customer actually said.
 *
 * An AI decision node has always been a placeholder outside a live call: it
 * reported `skipped` and took the first exit. On a voice workflow that is at
 * least visible — the live agent makes the real decision and the run is a
 * replay. On the WhatsApp chatbot I shipped yesterday it is a defect: a graph
 * asking "is this about buying or renting?" always answered "buying", silently,
 * for every customer.
 *
 * So on a channel where there *is* a conversation to read, the decision is
 * made. And when it cannot be made — no model connected, an unreadable answer,
 * a model naming an outcome that is not on the list — the run does not guess.
 * It takes the fallback exit the author chose, or it stops and says why.
 *
 * Pure — no database, no fetch — so the prompt and, more importantly, the
 * reading of the answer are tested directly.
 */

export type DecisionInput = {
  instruction: string;
  outcomes: string[];
  /** Oldest first, as they were said. */
  transcript: Array<{ from: 'customer' | 'business'; text: string }>;
};

/** How many messages of history a decision is allowed to read. */
export const TRANSCRIPT_LIMIT = 24;

export function decisionSystemPrompt(outcomes: string[]): string {
  return [
    'You are routing a customer conversation for an Indian business.',
    'Read the conversation and answer with exactly one of the allowed outcomes.',
    'Answer with the outcome and nothing else — no explanation, no punctuation.',
    `Allowed outcomes: ${outcomes.join(' | ')}`,
    'If the conversation does not clearly indicate one of them, answer: UNCLEAR',
  ].join('\n');
}

export function decisionMessages(input: DecisionInput): Array<{
  role: 'user';
  content: string;
}> {
  const lines = input.transcript
    .slice(-TRANSCRIPT_LIMIT)
    .map(
      (turn) =>
        `${turn.from === 'customer' ? 'Customer' : 'Business'}: ${turn.text.trim().slice(0, 600)}`,
    )
    .join('\n');
  return [
    {
      role: 'user',
      content: `${lines || '(no messages yet)'}\n\nDecide: ${input.instruction.trim()}`,
    },
  ];
}

export type DecisionReading =
  | { kind: 'decided'; outcome: string }
  | { kind: 'unclear' }
  | { kind: 'unreadable'; said: string };

/**
 * Reads the model's answer back into one of the author's outcomes.
 *
 * Forgiving about how it was written — case, quotes, a trailing full stop, a
 * "The answer is" preamble — and unforgiving about *which* it was. A model
 * naming something not on the list is `unreadable`, never the nearest guess:
 * routing a customer down a path nobody chose is worse than admitting the
 * decision failed.
 */
export function readDecision(
  said: unknown,
  outcomes: string[],
): DecisionReading {
  const text = typeof said === 'string' ? said.trim() : '';
  if (!text) return { kind: 'unreadable', said: '' };
  const cleaned = text
    .replace(/^["'`\s]+|["'`.\s]+$/g, '')
    .replace(/^(the\s+)?(answer|outcome)\s*(is|:)\s*/i, '')
    .trim();
  if (/^unclear$/i.test(cleaned)) return { kind: 'unclear' };

  const normalise = (value: string) =>
    value
      .toLowerCase()
      .replace(/[\s_-]+/g, ' ')
      .trim();
  const target = normalise(cleaned);
  for (const outcome of outcomes)
    if (normalise(outcome) === target) return { kind: 'decided', outcome };
  // A model that wrapped the outcome in a sentence still named it. One match
  // is an answer; two means the sentence discussed both, which is not one.
  const mentioned = outcomes.filter((outcome) =>
    target.includes(normalise(outcome)),
  );
  if (mentioned.length === 1) return { kind: 'decided', outcome: mentioned[0] };
  return { kind: 'unreadable', said: text.slice(0, 200) };
}

/**
 * What to do when the decision could not be made.
 *
 * Returns the author's fallback outcome when they named one and it is really
 * one of the exits, and null when they did not — in which case the caller
 * stops the run rather than picking an exit on the customer's behalf.
 */
export function fallbackOutcome(
  fallback: unknown,
  outcomes: string[],
): string | null {
  const text = typeof fallback === 'string' ? fallback.trim() : '';
  if (!text) return null;
  const normalise = (value: string) =>
    value
      .toLowerCase()
      .replace(/[\s_-]+/g, ' ')
      .trim();
  return (
    outcomes.find((outcome) => normalise(outcome) === normalise(text)) ?? null
  );
}

/** The sentence a run records when it could not decide and had nowhere to go. */
export function undecidedReason(reading: DecisionReading): string {
  if (reading.kind === 'unclear')
    return 'The conversation did not clearly indicate any of the outcomes, and this step has no fallback outcome to take.';
  if (reading.kind === 'unreadable' && reading.said)
    return `The model answered “${reading.said}”, which is not one of the outcomes, and this step has no fallback outcome to take.`;
  return 'The model returned nothing to read, and this step has no fallback outcome to take.';
}
