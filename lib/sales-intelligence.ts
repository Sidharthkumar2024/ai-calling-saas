/**
 * The post-call feedback loop (§10).
 *
 * §10 calls the Sales Intelligence Engine the product's own IP: qualification,
 * lead score, objection library, playbooks, next-best-action, memory, follow-up
 * rules and conversion analytics. Two halves of that loop were open.
 *
 * **A lead's score never changed after the form.** `analyzeLead` scored a lead
 * from its enquiry text — a regex over "price", "visit", "budget" — and that
 * number was the score for ever. `analyseCall` produced summary, intent,
 * sentiment and objections for every call and wrote them to `call_records` and
 * `call_quality_reviews`, and never once back to `leads.score`. So a lead who
 * had a twenty-minute conversation and asked for a site visit still scored
 * whatever their web form implied, and a lead who said "never call me again"
 * scored the same as before they said it. The most informative thing that can
 * happen to a lead — actually speaking to them — moved the number not at all.
 *
 * **Objections were collected and discarded.** Every call extracted them into
 * `summaries.objections_json`; nothing ever read them back. A workspace hearing
 * "too expensive" on forty calls had that written down forty times and could
 * not see it once.
 *
 * Pure: scoring and normalisation only, so the weights are visible and testable
 * rather than buried in a job.
 */

export type CallSignals = {
  outcome?: string | null;
  sentiment?: string | null;
  intent?: string | null;
  objections?: string[];
  /** Seconds of actual conversation. */
  durationSeconds?: number | null;
  /** How many turns the customer took. */
  customerTurns?: number | null;
};

export type Rescore = {
  score: number;
  previous: number;
  delta: number;
  /** Each contribution, so a change in a lead's score can be explained. */
  reasons: Array<{ signal: string; delta: number; note: string }>;
  status: 'won' | 'qualified' | 'nurture' | 'new' | 'lost';
  nextAction: string;
};

/**
 * What a conversation is worth to a lead's score.
 *
 * Outcomes dominate, because what someone *did* outranks how they sounded.
 * Sentiment adjusts. Objections cost a little — an objection is engagement, not
 * rejection, and scoring it like a refusal would punish exactly the leads worth
 * working on.
 */
const OUTCOME_WEIGHTS: Record<string, { delta: number; note: string }> = {
  appointment_booked: { delta: 28, note: 'booked an appointment' },
  payment_link_sent: { delta: 24, note: 'accepted a payment link' },
  resolved: { delta: 10, note: 'the call resolved what they asked' },
  callback_scheduled: { delta: 8, note: 'asked to be called back' },
  transferred_to_human: { delta: 6, note: 'wanted a person' },
  information_provided: { delta: 2, note: 'took information' },
  incomplete: { delta: -4, note: 'the call did not finish' },
  not_interested: { delta: -35, note: 'said they are not interested' },
};

const SENTIMENT_WEIGHTS: Record<string, { delta: number; note: string }> = {
  positive: { delta: 8, note: 'sounded positive' },
  neutral: { delta: 0, note: 'sounded neutral' },
  negative: { delta: -12, note: 'sounded negative' },
};

/**
 * Rescores a lead from what happened on the call.
 *
 * Clamped to 0..100 and moved by a bounded amount, so one bad call cannot erase
 * a lead who has been warming up for weeks, and one good call cannot promote a
 * cold lead straight to the top of the pipeline.
 */
export function rescoreLead(
  previousScore: number,
  signals: CallSignals,
): Rescore {
  const previous = Math.max(
    0,
    Math.min(100, Math.round(Number(previousScore) || 0)),
  );
  const reasons: Rescore['reasons'] = [];
  let delta = 0;

  const outcome = OUTCOME_WEIGHTS[String(signals.outcome ?? '')];
  if (outcome) {
    delta += outcome.delta;
    reasons.push({
      signal: 'outcome',
      delta: outcome.delta,
      note: outcome.note,
    });
  }

  const sentiment = SENTIMENT_WEIGHTS[String(signals.sentiment ?? '')];
  if (sentiment && sentiment.delta !== 0) {
    delta += sentiment.delta;
    reasons.push({
      signal: 'sentiment',
      delta: sentiment.delta,
      note: sentiment.note,
    });
  }

  // Talking at length is interest, whatever else was said. A ten-second call is
  // not.
  const seconds = Number(signals.durationSeconds ?? 0);
  const turns = Number(signals.customerTurns ?? 0);
  if (seconds >= 90 || turns >= 6) {
    delta += 6;
    reasons.push({
      signal: 'engagement',
      delta: 6,
      note: 'stayed on the call and kept talking',
    });
  } else if (seconds > 0 && seconds < 20) {
    delta -= 6;
    reasons.push({
      signal: 'engagement',
      delta: -6,
      note: 'ended the call almost immediately',
    });
  }

  const objections = (signals.objections ?? []).filter(Boolean);
  if (objections.length) {
    // Deliberately small, and capped. Someone arguing about price is closer to
    // buying than someone who said nothing at all.
    const cost = Math.max(-6, -2 * objections.length);
    delta += cost;
    reasons.push({
      signal: 'objections',
      delta: cost,
      note: `raised ${objections.length} objection${objections.length === 1 ? '' : 's'}`,
    });
  }

  // One call moves a lead by at most this much in either direction, except for
  // an explicit refusal, which is allowed to be decisive.
  const decisive = signals.outcome === 'not_interested';
  const bounded = decisive ? delta : Math.max(-25, Math.min(30, delta));
  const score = Math.max(0, Math.min(100, previous + bounded));

  const status: Rescore['status'] = decisive
    ? 'lost'
    : signals.outcome === 'payment_link_sent' ||
        signals.outcome === 'appointment_booked'
      ? 'won'
      : score >= 75
        ? 'qualified'
        : score >= 55
          ? 'nurture'
          : 'new';

  return {
    score,
    previous,
    delta: score - previous,
    reasons,
    status,
    nextAction: nextActionFor(status, signals),
  };
}

function nextActionFor(status: Rescore['status'], signals: CallSignals) {
  if (status === 'lost')
    return 'Suppress from campaigns and do not call again.';
  if (signals.outcome === 'appointment_booked')
    return 'Confirm the appointment and send the details.';
  if (signals.outcome === 'payment_link_sent')
    return 'Follow up on the payment link before it expires.';
  if (signals.outcome === 'callback_scheduled')
    return 'Call back at the time they asked for.';
  if ((signals.objections ?? []).length)
    return `Prepare an answer to: ${(signals.objections ?? [])[0]}.`;
  if (status === 'qualified') return 'Offer a site visit or a demo.';
  if (status === 'nurture') return 'Send supporting material and follow up.';
  return 'Qualify further on the next contact.';
}

/**
 * The wording a human reads, cleaned of machine formatting.
 *
 * The extraction model is asked for the caller's own phrasing and sometimes
 * returns an identifier instead — "price_too_high". That string is what the
 * workspace sees in the library and what the agent is briefed with, so it is
 * normalised here rather than displayed as-is.
 */
export function objectionLabel(text: string): string {
  const cleaned = String(text ?? '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Canonical key for an objection, so the library counts one thing once.
 *
 * "It's too expensive", "too expensive" and "Too expensive!" are the same
 * objection, and a library that lists them separately is a list rather than a
 * library.
 */
export function objectionKey(text: string): string {
  const cleaned = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  // Strip the openers people wrap an objection in, so the objection is what
  // remains rather than the sentence it arrived in.
  const stripped = cleaned
    .replace(
      /^(it s|it is|its|this is|that is|thats|i think|i feel|the|they said|customer said|he said|she said)\s+/,
      '',
    )
    .trim();
  return (stripped || cleaned).slice(0, 80);
}

/**
 * Words that carry no objection. Deliberately tiny: "not", "no" and "now" stay,
 * because "not now" and "not interested" are objections and stripping their
 * only content word would merge them with everything.
 */
const OBJECTION_NOISE = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'be',
  'been',
  'am',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'i',
  'we',
  'my',
  'our',
  'us',
  'me',
  'to',
  'of',
  'for',
  'and',
  'or',
  'so',
  'very',
  'too',
  'much',
  'bahut',
  'hai',
  'ka',
  'ki',
  'ke',
  'ko',
  'mera',
  'hamara',
  // The same words in Devanagari. A Hinglish transcript carries both scripts,
  // often in one sentence, and stripping only the romanised forms leaves a
  // Hindi objection carrying two extra tokens — enough to push it past the
  // one-word merge cap and file a rephrasing as a new row.
  'है',
  'हैं',
  'था',
  'थी',
  'थे',
  'का',
  'की',
  'के',
  'को',
  'में',
  'से',
  'पर',
  'और',
  'या',
  'यह',
  'वह',
  'ये',
  'वे',
  'बहुत',
  'मेरा',
  'हमारा',
]);

/** The content words of an objection, deduplicated and ordered. */
export function objectionTokens(text: string): string[] {
  const key = objectionKey(text);
  if (!key) return [];
  const tokens = [
    ...new Set(
      key.split(' ').filter((word) => word && !OBJECTION_NOISE.has(word)),
    ),
  ].sort();
  // An objection made entirely of noise words still needs an identity.
  return tokens.length ? tokens : [key];
}

/**
 * Finds the library row a newly-heard objection belongs to.
 *
 * This exists because a model does not phrase the same objection the same way
 * twice. One call yields "price too expensive" and the next yields "too
 * expensive"; string normalisation alone files them as two rows, so neither
 * ever passes the heard-more-than-once threshold and the library never
 * accumulates anything. That is a list, not a library — the exact failure this
 * module was written to end.
 *
 * The rule is containment with a cap: one objection's content words being a
 * subset of another's means the same objection stated more or less fully, but
 * only while the difference is a single word. Without that cap a one-word row
 * like "price" swallows "price not clear" and "price above budget" into one
 * meaningless bucket — over-merging destroys the library just as thoroughly as
 * not merging at all, and less visibly.
 */
export function findMergeTarget(
  tokens: string[],
  existing: Array<{ key: string; tokens: string[] }>,
): string | null {
  const incoming = new Set(tokens);
  if (!incoming.size) return null;
  for (const candidate of existing) {
    const other = new Set(candidate.tokens);
    if (!other.size) continue;
    const [smaller, larger] =
      incoming.size <= other.size ? [incoming, other] : [other, incoming];
    if (larger.size - smaller.size > 1) continue;
    let contained = true;
    for (const token of smaller)
      if (!larger.has(token)) {
        contained = false;
        break;
      }
    if (contained) return candidate.key;
  }
  return null;
}

export type ObjectionRow = {
  objection: string;
  count: number;
  /**
   * What the workspace has decided to say back. §10's playbook, in the only
   * form that is safe to hand a model: written by the business, not generated.
   */
  rebuttal?: string | null;
};

/**
 * Merges raw objections into a ranked library.
 *
 * The display label is the most common raw wording, so the workspace reads its
 * customers' words rather than a normalised key.
 */
export function buildObjectionLibrary(
  raw: string[],
  limit = 10,
): Array<ObjectionRow & { key: string }> {
  const groups = new Map<
    string,
    { count: number; labels: Map<string, number> }
  >();
  for (const entry of raw ?? []) {
    const key = objectionKey(entry);
    if (!key) continue;
    const group = groups.get(key) ?? { count: 0, labels: new Map() };
    group.count += 1;
    const label = objectionLabel(entry);
    if (!label) continue;
    group.labels.set(label, (group.labels.get(label) ?? 0) + 1);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      count: group.count,
      objection: [...group.labels.entries()].sort((a, b) => b[1] - a[1])[0][0],
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(1, limit));
}

/**
 * The prompt block that turns the library into preparation (§10 playbooks).
 *
 * Objections were being written down and never read; this is what reading them
 * looks like. An entry earns a place two ways, and they are not the same:
 *
 * - **A workspace-approved rebuttal** goes in however rare the objection is —
 *   somebody deliberately wrote an answer, and an answer written once and never
 *   used is the gap this whole module exists to close.
 * - **An objection with no rebuttal** goes in only once it has been heard more
 *   than once, and carries no suggested answer. A model handed "customers say
 *   it is too expensive" and no approved reply will invent a discount to get
 *   past it, which is precisely the failure §10 is trying to prevent. So it is
 *   told to expect the objection and to answer from approved knowledge or
 *   escalate — never to improvise commercial terms.
 */
export function objectionBriefing(library: ObjectionRow[], limit = 5): string {
  const entries = (library ?? [])
    .filter((entry) => (entry.rebuttal ? true : entry.count > 1))
    .slice(0, limit);
  if (!entries.length) return '';
  const lines = entries
    .map((entry) => {
      const rebuttal = String(entry.rebuttal ?? '').trim();
      return rebuttal
        ? `<objection heard="${entry.count}">${entry.objection}<approved_response>${rebuttal}</approved_response></objection>`
        : `<objection heard="${entry.count}" approved_response="none">${entry.objection}</objection>`;
    })
    .join('');
  return `<objection_playbook>Callers to this business have raised these objections before. Where an approved_response is given, use it — it is the business's own wording. Where none is given, acknowledge the concern and answer from approved knowledge or offer to have someone follow up. Never invent a discount, a policy, a guarantee or a comparison with a competitor to get past an objection.${lines}</objection_playbook>`;
}
