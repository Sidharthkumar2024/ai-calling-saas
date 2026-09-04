/**
 * AI Business Manager / Growth Manager (Blueprint §6).
 *
 * §6 asks for business discovery, an evidence board showing "observations,
 * source/evidence and confidence", a prioritised growth plan, chat, history,
 * reports and execution.
 *
 * The evidence board is the part that decides whether this module is worth
 * having. A growth manager that emits plausible advice — "improve your
 * follow-up cadence", "your conversion could be higher" — from no data at all
 * is indistinguishable from a horoscope, and this codebase has spent a long
 * time removing exactly that kind of thing. So the rule here is structural
 * rather than aspirational:
 *
 *   **An observation must carry the number it is derived from, the source that
 *   produced it, and a sample size. A recommendation must cite observations.
 *   Neither can be constructed without them.**
 *
 * Where the workspace has too little data to support a claim, this says so.
 * "Not enough calls yet to tell you anything about conversion" is a useful
 * sentence; a confident conversion insight computed from four calls is not.
 *
 * Pure: the question set, the confidence model and the ranking.
 */

export type DiscoveryQuestion = {
  id: string;
  question: string;
  /** Short label for the workspace chip that shows the answer back. */
  chip: string;
  /** Why it is asked — shown, so the interview does not feel like a form. */
  purpose: string;
  required: boolean;
};

/**
 * The discovery interview (§3, §6).
 *
 * §3 makes this the front door: "instead of forcing users to manually
 * configure dozens of screens, the platform interviews the customer". Kept
 * short deliberately — every question here changes what the product does with
 * the answer, and a question whose answer nothing reads is a form field
 * wearing an interview's clothes.
 */
export const DISCOVERY_QUESTIONS: DiscoveryQuestion[] = [
  {
    id: 'business',
    chip: 'Sells',
    question: 'What does your business sell, in your own words?',
    purpose: 'Decides the object schema and the agent’s opening.',
    required: true,
  },
  {
    id: 'website',
    chip: 'Website',
    question: 'What is your website?',
    purpose: 'Read for offers, pricing and pages worth answering from.',
    required: false,
  },
  {
    id: 'lead_definition',
    chip: 'A lead is',
    question: 'What counts as a lead for you?',
    purpose: 'Sets what the agent qualifies for and how leads are scored.',
    required: true,
  },
  {
    id: 'ideal_customer',
    chip: 'Audience',
    question: 'Who is your ideal customer?',
    purpose: 'Shapes qualification questions and lead priority.',
    required: true,
  },
  {
    id: 'goals',
    chip: 'Priority',
    question: 'What are you trying to achieve in the next quarter?',
    purpose:
      'Orders the growth plan; a booking goal and a collection goal ranks differently.',
    required: true,
  },
  {
    id: 'competitors',
    chip: 'Competitors',
    question: 'Who do customers compare you with?',
    purpose: 'Prepares the objection playbook for named comparisons.',
    required: false,
  },
];

export type DiscoveryAnswers = Record<string, string>;

export type DiscoveryState = {
  answered: string[];
  missingRequired: string[];
  complete: boolean;
  /** 0..1, over required questions only. */
  progress: number;
  nextQuestion: DiscoveryQuestion | null;
};

export function discoveryState(answers: DiscoveryAnswers): DiscoveryState {
  const given = (id: string) => String(answers?.[id] ?? '').trim().length > 2;
  const required = DISCOVERY_QUESTIONS.filter((q) => q.required);
  const answered = DISCOVERY_QUESTIONS.filter((q) => given(q.id)).map(
    (q) => q.id,
  );
  const missingRequired = required.filter((q) => !given(q.id)).map((q) => q.id);
  return {
    answered,
    missingRequired,
    complete: missingRequired.length === 0,
    progress: required.length
      ? (required.length - missingRequired.length) / required.length
      : 1,
    // Ask required questions first, then the optional ones.
    nextQuestion:
      DISCOVERY_QUESTIONS.find((q) => q.required && !given(q.id)) ??
      DISCOVERY_QUESTIONS.find((q) => !given(q.id)) ??
      null,
  };
}

/** Where an observation came from. Never a guess, never a model's opinion. */
export type EvidenceSource =
  | 'calls'
  | 'leads'
  | 'summaries'
  | 'objections'
  | 'campaigns'
  | 'knowledge'
  | 'discovery';

export type Observation = {
  id: string;
  /** One sentence stating what is true, with the number in it. */
  statement: string;
  source: EvidenceSource;
  /** The measurement itself, so the board shows the number not just the claim. */
  metric: { label: string; value: number; unit?: string };
  /** How many records the number is derived from. */
  sampleSize: number;
  confidence: Confidence;
};

export type Confidence = 'low' | 'medium' | 'high';

/**
 * Confidence from sample size alone.
 *
 * Deliberately crude and deliberately honest: it says how much data is behind
 * a number, not how clever the analysis was. A conversion rate from nine calls
 * is a conversion rate from nine calls however it is computed, and dressing
 * that up as "high confidence" is the failure this whole module is trying to
 * avoid.
 */
export function confidenceFor(sampleSize: number): Confidence {
  const n = Number(sampleSize) || 0;
  if (n >= 100) return 'high';
  if (n >= 30) return 'medium';
  return 'low';
}

/** Below this, a number is not reported as an observation at all. */
export const MIN_SAMPLE = 5;

/**
 * Builds an observation, or refuses.
 *
 * Returns null when there is not enough behind it. A board that quietly drops
 * an unsupportable claim is better than one that shows it in grey — grey text
 * still gets read, quoted and acted on.
 */
export function observe(input: {
  id: string;
  statement: string;
  source: EvidenceSource;
  metric: { label: string; value: number; unit?: string };
  sampleSize: number;
}): Observation | null {
  const sampleSize = Number(input.sampleSize) || 0;
  if (sampleSize < MIN_SAMPLE) return null;
  if (!Number.isFinite(Number(input.metric?.value))) return null;
  return {
    id: input.id,
    statement: input.statement,
    source: input.source,
    metric: { ...input.metric, value: Number(input.metric.value) },
    sampleSize,
    confidence: confidenceFor(sampleSize),
  };
}

export type Recommendation = {
  id: string;
  title: string;
  /** What to actually do. */
  action: string;
  area: 'conversion' | 'follow_up' | 'coverage' | 'quality' | 'cost';
  /** Observation ids. A recommendation with none of these cannot exist. */
  evidence: string[];
  /** Inherited from the weakest evidence behind it. */
  confidence: Confidence;
  priority: number;
};

const CONFIDENCE_RANK: Record<Confidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * Attaches evidence to a proposed recommendation, or drops it.
 *
 * The confidence of advice is the confidence of the *weakest* thing it rests
 * on, not the average and certainly not the best. Advice built on one solid
 * number and one shaky one is shaky advice.
 */
export function recommend(
  proposal: Omit<Recommendation, 'evidence' | 'confidence'> & {
    evidence: Array<Observation | null>;
  },
): Recommendation | null {
  const evidence = proposal.evidence.filter(Boolean) as Observation[];
  // The structural rule: no evidence, no recommendation. Not a warning badge —
  // it does not get made.
  if (!evidence.length) return null;
  const weakest = evidence.reduce((worst, item) =>
    CONFIDENCE_RANK[item.confidence] < CONFIDENCE_RANK[worst.confidence]
      ? item
      : worst,
  );
  return {
    id: proposal.id,
    title: proposal.title,
    action: proposal.action,
    area: proposal.area,
    evidence: evidence.map((item) => item.id),
    confidence: weakest.confidence,
    priority: proposal.priority,
  };
}

/**
 * Orders the growth plan.
 *
 * Confidence outranks priority: a high-confidence, moderately important
 * finding is better advice than a guess about something important. Within the
 * same confidence, the more evidence behind it wins.
 */
export function rankRecommendations(
  recommendations: Array<Recommendation | null>,
  observations: Observation[] = [],
): Recommendation[] {
  const byId = new Map(observations.map((item) => [item.id, item]));
  const weight = (recommendation: Recommendation) =>
    recommendation.evidence.reduce(
      (total, id) => total + (byId.get(id)?.sampleSize ?? 0),
      0,
    );
  return (recommendations.filter(Boolean) as Recommendation[]).sort((a, b) => {
    const confidence =
      CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (confidence !== 0) return confidence;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return weight(b) - weight(a);
  });
}

/**
 * What to say when there is nothing worth saying.
 *
 * §6 promises a growth plan; a workspace two days old cannot have one, and the
 * useful answer is what would produce one rather than filler dressed as
 * insight.
 */
export function insufficientData(input: {
  calls: number;
  leads: number;
}): string | null {
  if (input.calls >= MIN_SAMPLE || input.leads >= MIN_SAMPLE) return null;
  const need = MIN_SAMPLE - Math.max(input.calls, input.leads);
  return `Not enough has happened yet to tell you anything you could act on. About ${need} more calls or leads and this board starts filling itself.`;
}
