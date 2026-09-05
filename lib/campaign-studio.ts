/**
 * The rest of the Campaign Opening Studio (Part 2.2).
 *
 * The four identities — company, team, executive, customer — already exist in
 * `campaign-opening`. This adds the three settings around them: how the
 * opening is pitched, testing two openings against each other, and what
 * counts as a qualified caller.
 *
 * The A/B half is where this kind of feature usually starts lying, in two
 * specific ways, and both are structural here rather than cautioned about:
 *
 * **A split with no outcomes is not a result.** Two variants at 3 calls and 1
 * call have no winner, and a screen that draws a bar chart of them has
 * invented one. Nothing is declared until each side has enough calls to mean
 * something, and until then the honest answer is how many more are needed.
 *
 * **Assignment must not drift.** A caller who is re-dialled has to land on the
 * same variant, or the test measures the dialer's retry pattern rather than
 * the opening. So a contact's variant is derived from its own identity, not
 * from a counter or a coin flip.
 *
 * Pure: the pitch styles, the split, the scoring and the verdict.
 */

export const OPENING_STYLES = [
  'standard',
  'premium',
  'consultative',
  'short',
  'custom',
] as const;
export type OpeningStyle = (typeof OPENING_STYLES)[number];

export function isOpeningStyle(value: unknown): value is OpeningStyle {
  return (
    typeof value === 'string' &&
    (OPENING_STYLES as readonly string[]).includes(value)
  );
}

/**
 * What each style tells the agent. Guidance for the model rather than a fixed
 * script, because the opening still has to be rendered in the caller's own
 * language and around whatever the identity settings produced.
 */
export const STYLE_GUIDANCE: Record<OpeningStyle, string> = {
  standard:
    'Introduce yourself plainly and say why you are calling in one sentence.',
  premium:
    'Unhurried and courteous. Acknowledge their time before asking for it, and never rush the first exchange.',
  consultative:
    'Lead with a question about their situation rather than with what you sell. Listen before offering anything.',
  short:
    'Two sentences at most before your first question. Assume the caller is busy.',
  custom: 'Follow the workspace’s own wording exactly.',
};

export const STYLE_LABEL: Record<OpeningStyle, string> = {
  standard: 'Standard',
  premium: 'Premium',
  consultative: 'Consultative',
  short: 'Short',
  custom: 'Custom',
};

/* ------------------------------------------------------------------ *
 * A/B testing
 * ------------------------------------------------------------------ */

export type Variant = {
  key: string;
  label: string;
  /** Share of contacts, 0–100. Two variants normally split 50/50. */
  share: number;
};

/** Below this per side, no winner is declared and the screen says so. */
export const MIN_VARIANT_CALLS = 30;

/**
 * Which variant a contact gets.
 *
 * Derived from the contact's own id so a redial lands on the same opening. A
 * counter or a random draw would reassign on every retry, and the test would
 * be measuring the dialer rather than the wording.
 */
export function assignVariant(
  contactKey: string,
  variants: Variant[],
): Variant | null {
  const usable = variants.filter((variant) => variant.share > 0);
  if (usable.length === 0) return null;
  if (usable.length === 1) return usable[0];

  const total = usable.reduce((sum, variant) => sum + variant.share, 0);
  if (total <= 0) return null;

  let point = stableFraction(contactKey) * total;
  for (const variant of usable) {
    point -= variant.share;
    if (point < 0) return variant;
  }
  return usable[usable.length - 1];
}

/**
 * A stable 0–1 fraction from a key.
 *
 * FNV-1a alone was not enough. Its low bits stay correlated for inputs
 * differing only near the end, and phone numbers are allocated in blocks — so
 * consecutive contacts alternated in a fixed `aabbaabb` pattern instead of
 * spreading, and numbers sharing a repeated suffix landed almost entirely on
 * one variant. The avalanche step is what decorrelates them.
 *
 * Deterministic across processes and deploys, which a runtime's own string
 * hash is not.
 */
function stableFraction(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  // MurmurHash3's finaliser: the mixing FNV does not do.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

export type VariantResult = {
  key: string;
  label: string;
  calls: number;
  conversions: number;
};

export type Verdict = {
  decided: boolean;
  /** The winning key, only when there is one. */
  winner: string | null;
  /** What the screen says. Never a bar chart of four calls. */
  message: string;
  rates: Array<{ key: string; label: string; calls: number; rate: number }>;
};

/**
 * Reads an A/B test.
 *
 * The bar is deliberately blunt: enough calls on both sides, and a gap wide
 * enough not to be noise. This is not a significance test and does not claim
 * to be one — it is a floor that stops the obvious mistake of calling a
 * winner from a handful of calls.
 */
export const MIN_LIFT_POINTS = 5;

export function readTest(results: VariantResult[]): Verdict {
  const rates = results.map((result) => ({
    key: result.key,
    label: result.label,
    calls: result.calls,
    rate:
      result.calls > 0
        ? Math.round((result.conversions / result.calls) * 1000) / 10
        : 0,
  }));

  if (results.length < 2)
    return {
      decided: false,
      winner: null,
      message:
        'Only one opening is running, so there is nothing to compare it with.',
      rates,
    };

  const thin = results.filter((result) => result.calls < MIN_VARIANT_CALLS);
  if (thin.length > 0) {
    const needed = thin
      .map(
        (result) =>
          `${result.label} needs ${MIN_VARIANT_CALLS - result.calls} more`,
      )
      .join(', ');
    return {
      decided: false,
      winner: null,
      // The useful sentence: how far off a real answer is.
      message: `Not enough calls to tell these apart yet — ${needed}.`,
      rates,
    };
  }

  const sorted = [...rates].sort((a, b) => b.rate - a.rate);
  const gap = Math.round((sorted[0].rate - sorted[1].rate) * 10) / 10;
  if (gap < MIN_LIFT_POINTS)
    return {
      decided: false,
      winner: null,
      message: `${sorted[0].label} is ahead by ${gap} points, which is close enough to be noise. Keep both running.`,
      rates,
    };

  return {
    decided: true,
    winner: sorted[0].key,
    message: `${sorted[0].label} converts ${gap} points better over ${sorted[0].calls} and ${sorted[1].calls} calls. This is a comparison of two openings, not proof that the wording caused the difference.`,
    rates,
  };
}

/* ------------------------------------------------------------------ *
 * Qualification
 * ------------------------------------------------------------------ */

export type QualificationRule = {
  /** The variable an Ask step collected. */
  variable: string;
  /** `equals`, `contains`, `at_least`, `at_most`. */
  operator: 'equals' | 'contains' | 'at_least' | 'at_most';
  value: string;
  /** Added to the score when it matches. Negative is allowed. */
  points: number;
  /** When true, a match ends the call as not a fit whatever the score. */
  disqualifies?: boolean;
};

export type Qualification = {
  rules: QualificationRule[];
  /** At or above this, the caller is qualified. */
  threshold: number;
};

export type ScoreResult = {
  score: number;
  qualified: boolean;
  disqualified: boolean;
  /** Every rule that fired, so a score is explainable rather than a number. */
  reasons: string[];
  /** Rules that could not be judged because nothing was collected. */
  unanswered: string[];
};

/**
 * Scores a caller against the campaign's rules.
 *
 * A disqualifier wins over any score. Somebody outside the service area is not
 * a better prospect for having answered three other questions well, and a
 * points system that can outvote a hard no is a points system that will.
 *
 * A rule whose variable was never collected does not silently score zero — it
 * is reported, because "we never asked" and "they answered badly" are
 * different facts about a call.
 */
export function scoreCaller(input: {
  qualification: Qualification;
  answers: Record<string, unknown>;
}): ScoreResult {
  let score = 0;
  let disqualified = false;
  const reasons: string[] = [];
  const unanswered: string[] = [];

  for (const rule of input.qualification.rules ?? []) {
    const raw = answerText(input.answers?.[rule.variable]);
    if (raw === '') {
      unanswered.push(rule.variable);
      continue;
    }
    if (!matches(rule, raw)) continue;
    if (rule.disqualifies) {
      disqualified = true;
      reasons.push(`${rule.variable} ${describeRule(rule)} — disqualified`);
      continue;
    }
    score += rule.points;
    reasons.push(
      `${rule.variable} ${describeRule(rule)} — ${rule.points >= 0 ? '+' : ''}${rule.points}`,
    );
  }

  return {
    score,
    qualified: !disqualified && score >= (input.qualification.threshold ?? 0),
    disqualified,
    reasons,
    unanswered,
  };
}

/** Answers come from a live call, so only a primitive is an answer. */
function answerText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}

function matches(rule: QualificationRule, raw: string): boolean {
  const answer = raw.trim().toLowerCase();
  const target = String(rule.value ?? '')
    .trim()
    .toLowerCase();
  if (rule.operator === 'equals') return answer === target;
  if (rule.operator === 'contains') return answer.includes(target);
  const answerNumber = Number(answer.replace(/[^\d.-]/g, ''));
  const targetNumber = Number(target);
  if (!Number.isFinite(answerNumber) || !Number.isFinite(targetNumber))
    return false;
  return rule.operator === 'at_least'
    ? answerNumber >= targetNumber
    : answerNumber <= targetNumber;
}

function describeRule(rule: QualificationRule): string {
  if (rule.operator === 'equals') return `is “${rule.value}”`;
  if (rule.operator === 'contains') return `mentions “${rule.value}”`;
  return rule.operator === 'at_least'
    ? `is at least ${rule.value}`
    : `is at most ${rule.value}`;
}
