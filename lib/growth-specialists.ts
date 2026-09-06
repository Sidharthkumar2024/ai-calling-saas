/**
 * The specialists behind one growth answer, and the rules for reading them.
 *
 * A single pass over every fact a workspace holds produces a general answer:
 * it notices the loudest thing and stops. Splitting the same evidence between
 * focused readers — one on the calls, one on the site, one on the pipeline,
 * one on what is not connected — and then ranking what they each found is what
 * turns "your conversion is low" into a worklist.
 *
 * Two rules run through this file, and both exist because the alternative is a
 * confident invention:
 *
 *  1. A specialist with no evidence returns *no findings*. Not a hedge, not a
 *     general best practice — nothing, and the run says the lane was skipped
 *     and why. "Nothing measured here yet" is a true sentence; "consider
 *     optimising your funnel" is filler that costs a reader their trust.
 *  2. Every finding names the evidence it came from. A finding whose evidence
 *     is empty is dropped before anyone sees it, however plausible it reads.
 *
 * Pure — no database, no provider — so the roster, the parsing of what a model
 * returns, and the ranking are all tested directly.
 */

export type SpecialistId = 'calls' | 'website' | 'pipeline' | 'readiness';

export type EvidenceSlice = {
  /** Measured figures, already rendered as sentences by the board. */
  observations: Array<{
    source: string;
    statement: string;
    sampleSize: number;
  }>;
  /** Website scan findings, if a scan has run. */
  siteFindings: Array<{ page: string; title: string; severity: string }>;
  /** Objections heard on calls. */
  objections: Array<{ label: string; occurrences: number }>;
  /** Sources §6 wants that this workspace has not connected. */
  missingSources: string[];
};

export type Specialist = {
  id: SpecialistId;
  label: string;
  /** What this one is looking for, in the brief handed to the model. */
  brief: string;
  /** Which sources count as this specialist's own evidence. */
  sources: string[];
};

export const SPECIALISTS: Specialist[] = [
  {
    id: 'calls',
    label: 'Calls',
    sources: ['calls', 'summaries', 'objections'],
    brief:
      'What the calls themselves show: where conversations stop converting, which objections repeat, and what the agent should say differently. Quote the measured figure in every finding.',
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    sources: ['leads', 'campaigns'],
    brief:
      'What happens to leads after capture: which sources produce qualified leads, where they stall, and which follow-up is missing. Quote the measured figure in every finding.',
  },
  {
    id: 'website',
    label: 'Website',
    sources: ['website'],
    brief:
      'What the site scan found: pages that cannot be read by search engines, missing calls to action, and pages with no path to a booking. Name the page in every finding.',
  },
  {
    id: 'readiness',
    label: 'Readiness',
    sources: ['not_connected'],
    brief:
      'What this workspace cannot yet see, and what connecting it would answer. One finding per disconnected source, saying which question it would settle. Never guess at the numbers behind it.',
  },
];

export const SEVERITIES = ['high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];

export function isSeverity(value: unknown): value is Severity {
  return (SEVERITIES as readonly string[]).includes(String(value));
}

export type Finding = {
  specialist: SpecialistId;
  severity: Severity;
  title: string;
  /** The measurement or page this rests on. A finding without one is dropped. */
  evidence: string;
  doThis: string;
};

/**
 * Whether a specialist has anything to read.
 *
 * Called before the model is, so a lane with no evidence costs nothing and is
 * reported as skipped rather than as an empty answer.
 */
export function hasEvidence(
  specialist: Specialist,
  slice: EvidenceSlice,
): boolean {
  if (specialist.id === 'website') return slice.siteFindings.length > 0;
  if (specialist.id === 'readiness') return slice.missingSources.length > 0;
  const owned = slice.observations.filter((observation) =>
    specialist.sources.includes(observation.source),
  );
  if (owned.length > 0) return true;
  return specialist.id === 'calls' && slice.objections.length > 0;
}

/** Why a lane was skipped, in the words the reader sees. */
export function skipReason(specialist: Specialist): string {
  switch (specialist.id) {
    case 'website':
      return 'No website scan yet — run one and this lane has something to read.';
    case 'readiness':
      return 'Every source this workspace needs is connected.';
    case 'pipeline':
      return 'No lead or campaign figures measured yet.';
    default:
      return 'No call figures measured yet.';
  }
}

/**
 * Reads a specialist's reply.
 *
 * Models return JSON when asked and prose when they forget, and both arrive
 * wrapped in a code fence about a third of the time. This takes the first JSON
 * array it can find, keeps the entries that are shaped like findings, and
 * silently drops the rest — a malformed lane is worth losing, an invented
 * finding is not.
 */
export function parseFindings(
  specialist: SpecialistId,
  raw: string,
): Finding[] {
  const text = String(raw ?? '').trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const findings: Finding[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const title = plainText(row.title);
    const evidence = plainText(row.evidence);
    const doThis = plainText(row.doThis) || plainText(row.do_this);
    // Rule 2: no evidence, no finding — however well it reads.
    if (!title || !evidence) continue;
    findings.push({
      specialist,
      severity: isSeverity(row.severity) ? row.severity : 'medium',
      title: title.slice(0, 160),
      evidence: evidence.slice(0, 240),
      doThis: doThis.slice(0, 240),
    });
  }
  return findings.slice(0, 6);
}

/**
 * A field only counts if the model sent a string.
 *
 * An object here used to stringify to "[object Object]", which then passed the
 * "has evidence" check and put that literal text in front of a reader.
 */
function plainText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * A lane's result, with "found nothing" kept apart from "could not be read".
 *
 * Both used to arrive as an empty array, and the screen said "0 findings" for
 * each — which reads as *this lane is clear*. One of them means the opposite:
 * the specialist answered and its answer was thrown away. A reader deciding
 * what to work on this week deserves to know which of the two happened.
 */
export type LaneResult = {
  findings: Finding[];
  status: 'ok' | 'empty' | 'unusable';
};

export function readLane(specialist: SpecialistId, raw: string): LaneResult {
  const text = String(raw ?? '').trim();
  const findings = parseFindings(specialist, text);
  if (findings.length > 0) return { findings, status: 'ok' };
  // An explicit empty array is a specialist saying "nothing here", which is
  // exactly the answer rule 1 asks for, and the lane really is clear.
  //
  // Everything else that reached zero is `unusable`: prose instead of JSON,
  // broken JSON, or entries that were all dropped for citing no evidence. They
  // differ in cause and not in consequence — the specialist spoke and none of
  // it can be shown to anyone — and one word the reader can act on beats three
  // that describe our parser.
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
      if (Array.isArray(parsed) && parsed.length === 0)
        return { findings, status: 'empty' };
    } catch {
      return { findings, status: 'unusable' };
    }
  }
  return { findings, status: text ? 'unusable' : 'empty' };
}

const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/**
 * The worklist order: severity first, then one from each lane before a second
 * from any of them.
 *
 * Straight severity sorting let the loudest specialist fill the whole list —
 * four website findings above the one call figure that explained them.
 */
export function rankFindings(findings: Finding[]): Finding[] {
  const lanes = new Map<SpecialistId, Finding[]>();
  for (const finding of findings) {
    const lane = lanes.get(finding.specialist) ?? [];
    lane.push(finding);
    lanes.set(finding.specialist, lane);
  }
  for (const lane of lanes.values())
    lane.sort((left, right) => ORDER[left.severity] - ORDER[right.severity]);

  const ranked: Finding[] = [];
  let round = 0;
  for (;;) {
    const picked = [...lanes.values()]
      .map((lane) => lane[round])
      .filter((finding): finding is Finding => Boolean(finding));
    if (picked.length === 0) break;
    picked.sort((left, right) => ORDER[left.severity] - ORDER[right.severity]);
    ranked.push(...picked);
    round += 1;
  }
  return ranked;
}

/** The line the reader sees above the list. */
export function summariseRun(input: {
  findings: Finding[];
  ran: SpecialistId[];
  skipped: SpecialistId[];
}): string {
  const high = input.findings.filter((finding) => finding.severity === 'high');
  const lanes = `${input.ran.length} of ${input.ran.length + input.skipped.length} lanes`;
  if (input.findings.length === 0)
    return `${lanes} read, nothing worth acting on yet.`;
  return `${input.findings.length} finding${input.findings.length === 1 ? '' : 's'} across ${lanes}${high.length ? `, ${high.length} high priority` : ''}.`;
}

/** The brief a specialist is given. Its own slice, and nothing else. */
export function specialistPrompt(
  specialist: Specialist,
  slice: EvidenceSlice,
): string {
  const parts: string[] = [];
  if (specialist.id === 'website')
    parts.push(
      `<website_findings>${slice.siteFindings
        .map(
          (finding) =>
            `<finding page="${finding.page}" severity="${finding.severity}">${finding.title}</finding>`,
        )
        .join('')}</website_findings>`,
    );
  else if (specialist.id === 'readiness')
    parts.push(
      `<not_connected>${slice.missingSources.join(', ')}</not_connected>`,
    );
  else {
    const owned = slice.observations.filter((observation) =>
      specialist.sources.includes(observation.source),
    );
    if (owned.length)
      parts.push(
        `<measured>${owned
          .map(
            (observation) =>
              `<figure source="${observation.source}" sample="${observation.sampleSize}">${observation.statement}</figure>`,
          )
          .join('')}</measured>`,
      );
    if (specialist.id === 'calls' && slice.objections.length)
      parts.push(
        `<objections>${slice.objections
          .map(
            (objection) =>
              `<objection heard="${objection.occurrences}">${objection.label}</objection>`,
          )
          .join('')}</objections>`,
      );
  }

  return `You are the ${specialist.label.toLowerCase()} specialist for one business. ${specialist.brief}

Return a JSON array and nothing else. Each entry: {"severity":"high"|"medium"|"low","title":string,"evidence":string,"doThis":string}.
"evidence" must quote a figure or page from the brief below. If the brief does not support a finding, return []. Never write a finding you cannot point at.
At most 4 findings, strongest first.

${parts.join('\n')}`;
}
