/**
 * Mining historical calls into a company playbook (§13.1).
 *
 * §13.1 opens with the warning that matters: *"Do not treat uploaded
 * recordings as magical 'training'. The first practical use is conversation
 * mining."* So nothing here trains anything. It counts.
 *
 * Which makes the honesty problem sharp, because counting words across two
 * piles of calls will always produce a ranked list, and a ranked list always
 * looks like insight. Three rules keep it from becoming one:
 *
 * **Two cohorts or nothing.** You cannot learn what wins by reading only the
 * calls that won. A phrase in every successful call is worthless if it is also
 * in every unsuccessful one — that is just how your agent talks. Every claim
 * here is a contrast, and if either side is too small there is no claim.
 *
 * **The counts travel with the claim.** "4 of 6 won calls, 0 of 41 lost" is a
 * finding a person can weigh. "Successful reps mention financing" is a
 * horoscope.
 *
 * **It is correlation, and it says so.** A phrase that appears in winning
 * calls did not cause them to win. The playbook carries that sentence into the
 * UI rather than leaving it to be inferred, and every entry needs a human to
 * approve it before anything reads from it.
 *
 * No stop-word list. A term appearing in nearly every call is not distinctive
 * vocabulary and a term in one call is not vocabulary either, and those two
 * bounds do the job in any language — which matters here, because these
 * transcripts are Hindi, Hinglish and English in the same sentence.
 *
 * Pure: cohorts, tokenising, contrast and the shape of a playbook.
 */

/** Outcomes that mean the call achieved what it was for. */
export const WON_OUTCOMES = [
  'payment_link_sent',
  'payment_link_requested',
  'converted',
  'resolved',
  'appointment_booked',
  'order_placed',
];

/** Outcomes that mean it did not. */
export const LOST_OUTCOMES = [
  'not_interested',
  'abandoned',
  'refused',
  'failed',
];

/**
 * Outcomes that are genuinely neither, and are excluded rather than assigned.
 * A callback scheduled is not a win and not a loss, and forcing it into one
 * pile to make the cohorts bigger would corrupt every contrast drawn from them.
 */
export const AMBIGUOUS_OUTCOMES = [
  'callback_scheduled',
  'information_provided',
  'transferred_to_human',
  'in_progress',
  'incomplete',
  'unknown',
  'completed',
];

/** Below this on either side, no contrast is drawn at all. */
export const MIN_COHORT = 5;

export type MinedCall = {
  id: string;
  outcome: string | null;
  transcript: string;
};

export type Cohorts = {
  won: MinedCall[];
  lost: MinedCall[];
  /** Calls deliberately left out, and why — never silently dropped. */
  excluded: Array<{ outcome: string; count: number; reason: string }>;
  /** Null when a contrast can be drawn; the reason when it cannot. */
  blocked: string | null;
};

export function splitCohorts(calls: MinedCall[]): Cohorts {
  const won: MinedCall[] = [];
  const lost: MinedCall[] = [];
  const excludedCounts = new Map<string, { count: number; reason: string }>();

  const note = (outcome: string, reason: string) => {
    const current = excludedCounts.get(outcome) ?? { count: 0, reason };
    excludedCounts.set(outcome, { count: current.count + 1, reason });
  };

  for (const call of calls) {
    const outcome = (call.outcome ?? 'unknown').trim().toLowerCase();
    if (!call.transcript.trim()) {
      note(outcome, 'No transcript to read.');
      continue;
    }
    if (WON_OUTCOMES.includes(outcome)) won.push(call);
    else if (LOST_OUTCOMES.includes(outcome)) lost.push(call);
    else
      note(
        outcome,
        AMBIGUOUS_OUTCOMES.includes(outcome)
          ? 'Neither a win nor a loss, so it would corrupt the contrast.'
          : 'Not an outcome this build can place on either side.',
      );
  }

  const excluded = [...excludedCounts.entries()].map(([outcome, entry]) => ({
    outcome,
    count: entry.count,
    reason: entry.reason,
  }));

  let blocked: string | null = null;
  if (won.length < MIN_COHORT && lost.length < MIN_COHORT)
    blocked = `Only ${won.length} calls clearly succeeded and ${lost.length} clearly did not. ${MIN_COHORT} of each are needed before one can be compared with the other.`;
  else if (won.length < MIN_COHORT)
    blocked = `Only ${won.length} of these calls clearly succeeded. Until there are ${MIN_COHORT}, anything that looks like a winning pattern is the wording of ${won.length} conversations.`;
  else if (lost.length < MIN_COHORT)
    blocked = `Only ${lost.length} of these calls clearly did not succeed. Without a comparison group, a phrase common in the wins is just how your agent talks.`;

  return { won, lost, excluded, blocked };
}

/* ------------------------------------------------------------------ *
 * Reading a transcript
 * ------------------------------------------------------------------ */

export type Turn = { speaker: 'agent' | 'customer'; text: string };

/**
 * Splits "Agent: … / Customer: …" into turns.
 *
 * The two sides answer different questions, and mixing them ruins both. What
 * *customers* say is the vocabulary your buyers use for your product. What the
 * *agent* says is what may or may not be working. A word count over the whole
 * transcript conflates the two and mostly measures the agent's own script.
 */
export function splitTurns(transcript: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of transcript.split('\n')) {
    const match =
      /^\s*(agent|customer|caller|user|assistant)\s*[::]\s*(.*)$/i.exec(line);
    if (!match) {
      // A continuation line belongs to whoever was speaking.
      if (turns.length > 0 && line.trim())
        turns[turns.length - 1].text += ` ${line.trim()}`;
      continue;
    }
    const who = match[1].toLowerCase();
    turns.push({
      speaker: who === 'agent' || who === 'assistant' ? 'agent' : 'customer',
      text: match[2].trim(),
    });
  }
  return turns.filter((turn) => turn.text.length > 0);
}

export function textOf(transcript: string, speaker: Turn['speaker']): string {
  return splitTurns(transcript)
    .filter((turn) => turn.speaker === speaker)
    .map((turn) => turn.text)
    .join(' ');
}

/**
 * Words, in any script.
 *
 * `\p{L}` and `\p{N}` rather than `\w`, because these transcripts are Hindi and
 * Hinglish in the same sentence and `\w` would throw away every Devanagari
 * word in the corpus.
 *
 * `\p{M}` matters just as much and is easier to miss. Devanagari builds
 * words out of letters plus combining marks — the matras and the virama —
 * which are Marks, not Letters. Without it "नमस्ते" tokenises as "नमस", and
 * every Hindi word in this corpus is cut silently at its first vowel sign.
 * The mining would still have produced a confident ranked list; it would
 * have been a list of fragments.
 */
export function tokenise(text: string): string[] {
  return (
    text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*/gu) ?? []
  ).filter((token) => token.length > 1);
}

export function ngrams(tokens: string[], size: number): string[] {
  const out: string[] = [];
  for (let index = 0; index + size <= tokens.length; index += 1)
    out.push(tokens.slice(index, index + size).join(' '));
  return out;
}

/** How many documents each term appears in — not how many times in total. */
export function documentFrequency(documents: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const document of documents)
    for (const term of new Set(document))
      counts.set(term, (counts.get(term) ?? 0) + 1);
  return counts;
}

/* ------------------------------------------------------------------ *
 * Vocabulary
 * ------------------------------------------------------------------ */

export type VocabularyEntry = {
  term: string;
  /** Calls the customer used it in. */
  calls: number;
  share: number;
};

/**
 * The words customers use, that are neither universal nor one-offs.
 *
 * The upper bound is what replaces a stop-word list: a term in 85% of calls is
 * "hello", not vocabulary. The lower bound stops a single talkative caller
 * defining the company's language. Both work in any script, which a curated
 * Hindi stop-word list written by me would not.
 */
export const VOCABULARY_UPPER_SHARE = 0.85;
export const VOCABULARY_MIN_CALLS = 3;

export function customerVocabulary(
  transcripts: string[],
  limit = 25,
): VocabularyEntry[] {
  const documents = transcripts.map((transcript) =>
    tokenise(textOf(transcript, 'customer')),
  );
  const withContent = documents.filter((document) => document.length > 0);
  if (withContent.length < VOCABULARY_MIN_CALLS) return [];
  const frequency = documentFrequency(withContent);
  return [...frequency.entries()]
    .map(([term, calls]) => ({
      term,
      calls,
      share: calls / withContent.length,
    }))
    .filter(
      (entry) =>
        entry.calls >= VOCABULARY_MIN_CALLS &&
        entry.share <= VOCABULARY_UPPER_SHARE,
    )
    .sort((a, b) => b.calls - a.calls || a.term.localeCompare(b.term))
    .slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Contrast
 * ------------------------------------------------------------------ */

export type ContrastEntry = {
  phrase: string;
  wonCalls: number;
  lostCalls: number;
  wonShare: number;
  lostShare: number;
  /** How much more of the winning side it covers. Positive means more. */
  lift: number;
};

/** A phrase has to reach this share of the winning side to be worth reporting. */
export const CONTRAST_MIN_WON_SHARE = 0.4;
/** …and stay this far below the losing side's share. */
export const CONTRAST_MIN_LIFT = 0.25;

/**
 * Phrases that separate the two piles.
 *
 * Reported in both directions, because "what the losing calls say and the
 * winning ones do not" is at least as useful as the reverse — that is where
 * the objection you keep failing to answer shows up.
 */
export function contrastPhrases(input: {
  won: string[];
  lost: string[];
  speaker: Turn['speaker'];
  /** Phrase lengths to look at. Longer ones absorb their own fragments. */
  sizes?: number[];
  limit?: number;
}): { winning: ContrastEntry[]; losing: ContrastEntry[] } {
  const sizes = input.sizes ?? [2, 3, 4];
  const prepare = (transcripts: string[]) =>
    transcripts.map((transcript) => {
      const tokens = tokenise(textOf(transcript, input.speaker));
      return new Set(sizes.flatMap((size) => ngrams(tokens, size)));
    });

  const wonDocuments = prepare(input.won);
  const lostDocuments = prepare(input.lost);
  if (wonDocuments.length === 0 || lostDocuments.length === 0)
    return { winning: [], losing: [] };

  const wonFrequency = documentFrequency(wonDocuments.map((set) => [...set]));
  const lostFrequency = documentFrequency(lostDocuments.map((set) => [...set]));
  const phrases = new Set([...wonFrequency.keys(), ...lostFrequency.keys()]);

  const entries: ContrastEntry[] = [];
  for (const phrase of phrases) {
    const wonCalls = wonFrequency.get(phrase) ?? 0;
    const lostCalls = lostFrequency.get(phrase) ?? 0;
    const wonShare = wonCalls / wonDocuments.length;
    const lostShare = lostCalls / lostDocuments.length;
    entries.push({
      phrase,
      wonCalls,
      lostCalls,
      wonShare: round(wonShare),
      lostShare: round(lostShare),
      lift: round(wonShare - lostShare),
    });
  }

  const limit = input.limit ?? 12;
  // Subsumption runs before the limit, not after. Cutting the list first
  // removes the longer phrases that would have absorbed their own fragments,
  // and what survives is "book a", "a site", "site visit" — one finding
  // rendered as three rows of evidence.
  const winning = dropSubsumed(
    entries
      .filter(
        (entry) =>
          entry.wonShare >= CONTRAST_MIN_WON_SHARE &&
          entry.lift >= CONTRAST_MIN_LIFT,
      )
      .sort((a, b) => b.lift - a.lift || b.wonCalls - a.wonCalls),
  ).slice(0, limit);
  const losing = dropSubsumed(
    entries
      .filter(
        (entry) =>
          entry.lostShare >= CONTRAST_MIN_WON_SHARE &&
          -entry.lift >= CONTRAST_MIN_LIFT,
      )
      .sort((a, b) => a.lift - b.lift || b.lostCalls - a.lostCalls),
  ).slice(0, limit);

  return { winning, losing };
}

/** A merged phrase stops here, so an identical corpus cannot return a transcript. */
export const MAX_MERGED_WORDS = 14;

/**
 * Collapses one finding into one row.
 *
 * Two things make a list of n-grams unreadable, and only one of them is
 * substrings. "site visit" inside "a site visit" is easy. The harder case is
 * a phrase sliding across a sentence — "book a site", "a site visit", "site
 * visit today" — none of which contains another, all of which are the same
 * observation counted four times. On a screen that ranks by evidence, that
 * turns one finding into four pieces of it.
 *
 * So overlapping n-grams with identical counts are joined end to end, and
 * anything contained in the result is dropped. Where the wording genuinely
 * diverges between calls the counts differ and the merge stops there, which is
 * the useful boundary: the longest phrase that consistently separates the two
 * piles.
 */
function dropSubsumed(entries: ContrastEntry[]): ContrastEntry[] {
  const merged: ContrastEntry[] = [];

  for (const entry of entries) {
    const words = entry.phrase.split(' ');
    const host = merged.find((candidate) => {
      if (
        candidate.wonCalls !== entry.wonCalls ||
        candidate.lostCalls !== entry.lostCalls
      )
        return false;
      const hostWords = candidate.phrase.split(' ');
      if (candidate.phrase.includes(entry.phrase)) return true;
      if (hostWords.length + 1 > MAX_MERGED_WORDS) return false;
      return overlapAt(hostWords, words) !== null;
    });
    if (!host) {
      merged.push({ ...entry });
      continue;
    }
    if (host.phrase.includes(entry.phrase)) continue;
    const hostWords = host.phrase.split(' ');
    const joined = overlapAt(hostWords, words);
    if (joined) host.phrase = joined.join(' ');
  }

  // A phrase that ended up inside a merged one is now redundant.
  return merged.filter(
    (entry) =>
      !merged.some(
        (other) =>
          other !== entry &&
          other.phrase.length > entry.phrase.length &&
          other.phrase.includes(entry.phrase),
      ),
  );
}

/**
 * Joins two word runs where the tail of one is the head of the other, in
 * either direction. Null when they do not overlap.
 */
function overlapAt(host: string[], candidate: string[]): string[] | null {
  for (
    let size = Math.min(host.length, candidate.length) - 1;
    size >= 1;
    size -= 1
  ) {
    if (host.slice(-size).join(' ') === candidate.slice(0, size).join(' '))
      return [...host, ...candidate.slice(size)];
    if (candidate.slice(-size).join(' ') === host.slice(0, size).join(' '))
      return [...candidate, ...host.slice(size)];
  }
  return null;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

/* ------------------------------------------------------------------ *
 * The playbook
 * ------------------------------------------------------------------ */

export type PlaybookSection =
  | 'winning_phrase'
  | 'losing_phrase'
  | 'vocabulary'
  | 'objection';

export type PlaybookEntry = {
  section: PlaybookSection;
  /** The phrase, term or objection itself, in the words it was said in. */
  content: string;
  /** The counts behind it, written out. Never a bare adjective. */
  evidence: string;
  wonCalls: number;
  lostCalls: number;
  confidence: 'low' | 'medium' | 'high';
};

/**
 * Confidence from cohort size alone.
 *
 * Not from lift. A phrase in 5 of 5 wins and 0 of 5 losses looks perfect and
 * rests on ten calls; the number that should govern how much weight it carries
 * is how many conversations were read, not how cleanly they split.
 */
export function miningConfidence(
  cohortSize: number,
): PlaybookEntry['confidence'] {
  if (cohortSize >= 40) return 'high';
  if (cohortSize >= 15) return 'medium';
  return 'low';
}

export type Playbook = {
  entries: PlaybookEntry[];
  wonCount: number;
  lostCount: number;
  excluded: Cohorts['excluded'];
  /** Why there is no contrast, when there is none. */
  blocked: string | null;
  /** The sentence that must travel with the whole thing. */
  caveat: string;
};

export const PLAYBOOK_CAVEAT =
  'These are phrases that appear more often on one side than the other. That is a correlation, not a cause: a phrase common in calls that closed did not close them. Read each one with its counts, and approve only the ones you would actually tell a new hire.';

export function buildPlaybook(input: {
  calls: MinedCall[];
  objections?: Array<{ label: string; occurrences: number }>;
}): Playbook {
  const cohorts = splitCohorts(input.calls);
  const entries: PlaybookEntry[] = [];
  const cohortSize = cohorts.won.length + cohorts.lost.length;

  // Vocabulary needs no contrast, so it survives even when the cohorts do not.
  const vocabulary = customerVocabulary(
    input.calls.map((call) => call.transcript),
  );
  for (const term of vocabulary)
    entries.push({
      section: 'vocabulary',
      content: term.term,
      evidence: `Customers said it in ${term.calls} of the calls read.`,
      wonCalls: 0,
      lostCalls: 0,
      confidence: miningConfidence(input.calls.length),
    });

  if (!cohorts.blocked) {
    const agent = contrastPhrases({
      won: cohorts.won.map((call) => call.transcript),
      lost: cohorts.lost.map((call) => call.transcript),
      speaker: 'agent',
    });
    for (const entry of agent.winning)
      entries.push({
        section: 'winning_phrase',
        content: entry.phrase,
        evidence: `Said in ${entry.wonCalls} of ${cohorts.won.length} calls that succeeded, and ${entry.lostCalls} of ${cohorts.lost.length} that did not.`,
        wonCalls: entry.wonCalls,
        lostCalls: entry.lostCalls,
        confidence: miningConfidence(cohortSize),
      });
    for (const entry of agent.losing)
      entries.push({
        section: 'losing_phrase',
        content: entry.phrase,
        evidence: `Said in ${entry.lostCalls} of ${cohorts.lost.length} calls that did not succeed, and ${entry.wonCalls} of ${cohorts.won.length} that did.`,
        wonCalls: entry.wonCalls,
        lostCalls: entry.lostCalls,
        confidence: miningConfidence(cohortSize),
      });
  }

  for (const objection of input.objections ?? [])
    entries.push({
      section: 'objection',
      content: objection.label,
      evidence: `Raised on ${objection.occurrences} calls.`,
      wonCalls: 0,
      lostCalls: 0,
      confidence: miningConfidence(objection.occurrences),
    });

  return {
    entries,
    wonCount: cohorts.won.length,
    lostCount: cohorts.lost.length,
    excluded: cohorts.excluded,
    blocked: cohorts.blocked,
    caveat: PLAYBOOK_CAVEAT,
  };
}
