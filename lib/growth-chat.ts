import {
  DISCOVERY_QUESTIONS,
  type DiscoveryAnswers,
  type Observation,
} from './growth-manager.ts';
import { SUPPORTED_LANGUAGES } from './languages.ts';

/**
 * The growth manager's chat (§6).
 *
 * §6 asks for "New chat: ask the manager questions about business data" and a
 * history of previous chats. The temptation is to wire a language model to a
 * text box and call it a business manager — which produces something that will
 * answer "what is my conversion rate?" with a confident number it invented.
 *
 * So the same rule as everywhere else in this module: the model is handed the
 * workspace's measured facts and told that those are the only figures it may
 * quote. When the facts do not cover the question it says so, and says what
 * would answer it. A growth manager that admits it has no Analytics connection
 * is more useful than one that guesses at traffic.
 *
 * Pure: prompt composition and context assembly.
 */

/**
 * Turns the workspace's own answers into the opening request.
 *
 * The reference product does this well: rather than an empty box, it composes
 * the run from what it already knows — "analyse X for Y, weighed against Z,
 * focused on W" — so a person does not retype their business every time.
 */
export function composeGoalPrompt(input: {
  answers: DiscoveryAnswers;
  goal?: string;
}): string {
  const answer = (id: string) => String(input.answers?.[id] ?? '').trim();
  const site = answer('website');
  const business = answer('business');
  const lead = answer('lead_definition');
  const competitors = answer('competitors');
  const goals = answer('goals');

  const stated = String(input.goal ?? '').trim();
  if (stated) return stated;

  const subject = site || business || 'my business';
  const parts = [`A prioritised growth plan for ${subject}`];
  if (lead) parts.push(`to win more ${lead.toLowerCase()}`);
  if (competitors) parts.push(`weighed against ${competitors}`);
  if (goals) parts.push(`focused on ${goals.toLowerCase()}`);
  return `${parts.join(', ')}.`;
}

/** The chips shown back, so nobody retypes what the manager already knows. */
export function workspaceChips(answers: DiscoveryAnswers) {
  return DISCOVERY_QUESTIONS.filter((question) =>
    String(answers?.[question.id] ?? '').trim(),
  ).map((question) => ({
    id: question.id,
    label: question.chip,
    value: String(answers[question.id]).trim().slice(0, 60),
  }));
}

export type ChatFacts = {
  answers: DiscoveryAnswers;
  observations: Observation[];
  scan?: {
    host: string;
    runId: string;
    pages: Array<{ path: string; title: string; wordCount: number }>;
    findings: Array<{
      page: string;
      title: string;
      doThis: string;
      evidence: string;
      severity: string;
    }>;
  } | null;
  objections: Array<{ label: string; occurrences: number }>;
  /** Sources §6 wants that this workspace has not connected. */
  missingSources: string[];
};

/**
 * Assembles everything the manager is allowed to answer from.
 *
 * Deliberately a plain rendering of stored facts rather than a summary written
 * by a model: a summary is already an interpretation, and the point of this
 * block is that every figure in the answer can be traced to a row.
 */
/**
 * How to read the call figures.
 *
 * Without this the model reasons about them as if they came from a human call
 * centre and reaches confidently wrong conclusions from correct numbers —
 * which is more dangerous than a wrong number, because the figures check out.
 * The first version of this chat read "9.3% of calls were handed to a person"
 * as "90% of your callers never reached anybody" and told the business its
 * call routing was broken. Nothing was broken: the AI agent had handled the
 * other 90% itself, which is the entire point of the product.
 */
const HOW_TO_READ = `<how_to_read_these>These calls are handled end to end by an AI voice agent, not by a human call centre.
- A transfer to a person is an escalation, not the goal. A low transfer rate means the agent handled the call itself, which is the product working. A high one means it could not.
- "Conversion" means the call reached a booking or a payment link.
- "Not interested" is the caller declining, not a failure to connect.
- Every one of these calls was answered. None of these figures says anything about calls that never connected — there is no such measurement here.</how_to_read_these>`;

export function buildChatContext(facts: ChatFacts): string {
  const blocks: string[] = [];
  if (facts.observations.length) blocks.push(HOW_TO_READ);

  const answered = DISCOVERY_QUESTIONS.filter((question) =>
    String(facts.answers?.[question.id] ?? '').trim(),
  );
  if (answered.length)
    blocks.push(
      `<business>${answered
        .map(
          (question) =>
            `<fact name="${question.chip}">${String(facts.answers[question.id]).slice(0, 400)}</fact>`,
        )
        .join('')}</business>`,
    );

  if (facts.observations.length)
    blocks.push(
      `<measured_from_calls>${facts.observations
        .map(
          (observation) =>
            `<figure source="${observation.source}" sample="${observation.sampleSize}" confidence="${observation.confidence}">${observation.statement}</figure>`,
        )
        .join('')}</measured_from_calls>`,
    );

  if (facts.scan)
    blocks.push(
      `<website host="${facts.scan.host}" run="${facts.scan.runId}">${facts.scan.pages
        .map(
          (page) =>
            `<page path="${page.path}" words="${page.wordCount}">${page.title}</page>`,
        )
        .join('')}${facts.scan.findings
        .map(
          (finding) =>
            `<finding page="${finding.page}" severity="${finding.severity}">${finding.title} — ${finding.doThis} (measured: ${finding.evidence})</finding>`,
        )
        .join('')}</website>`,
    );

  if (facts.objections.length)
    blocks.push(
      `<objections_heard_on_calls>${facts.objections
        .map(
          (objection) =>
            `<objection heard="${objection.occurrences}">${objection.label}</objection>`,
        )
        .join('')}</objections_heard_on_calls>`,
    );

  // Named explicitly. Without this the model fills the gap with a plausible
  // traffic figure, which is the single most damaging thing it could do here.
  if (facts.missingSources.length)
    blocks.push(
      `<not_connected>${facts.missingSources.join(', ')}. You have no data at all from these. If the question needs them, say which one would answer it and stop.</not_connected>`,
    );

  return blocks.join('\n');
}

/**
 * The instruction that keeps the answer tied to the facts.
 *
 * Every sentence here exists because of a specific way this goes wrong: a
 * confident invented number, a benchmark quoted from nowhere, generic advice
 * that would fit any business, or a recommendation that ignores what the
 * workspace actually said it sells.
 */
export const CHAT_SYSTEM_PROMPT = `You are the growth manager for one business, inside its own workspace.

Answer only from the facts given to you in the context blocks. Those are measurements from this workspace's own calls and its own website.

Rules you do not break:
- Never state a number that is not in the context. If you are asked something the context cannot answer, say plainly what is missing and which connection would answer it.
- Never quote an industry benchmark, average or "typical" figure. You have not measured one, and a made-up benchmark is worse than no benchmark.
- When you use a figure, say where it came from — the calls, the website scan, or what the business told you.
- Prefer one specific action this business can take on a named page or a named call outcome over general advice that would fit anybody.
- If the honest answer is that there is not enough data yet, give that answer and say what would produce it. That is a useful reply, not a failure.
- Be brief. A few sentences and at most a short list.`;

/**
 * Which language and script to answer in.
 *
 * Left unsaid, this reply came back in **Urdu** to a question typed in
 * Hinglish — Roman-script Hindi looks close enough to romanised Urdu that a
 * model with no instruction will pick either. An Indian business owner cannot
 * read the Arabic script, so the answer was worthless however good its content.
 *
 * `lib/languages.ts` already carries the script for every language it
 * supports, and says in its own comment why it is named explicitly. The voice
 * agent uses it. This did not.
 */
export function answerLanguageRule(code: string | null | undefined): string {
  const language =
    SUPPORTED_LANGUAGES.find((entry) => entry.code === code) ??
    SUPPORTED_LANGUAGES.find((entry) => entry.code === 'hinglish')!;
  return [
    '',
    'Language:',
    `- Answer in ${language.label}, written in ${language.script}.`,
    // The failure was picking a neighbouring language, so it is ruled out by
    // name rather than left to inference.
    '- Never answer in a language the business did not ask for. Roman-script Hindi is Hinglish, not Urdu; do not reply in Arabic script unless the language above is Urdu.',
    '- Keep product nouns people say in English — campaign, credits, CRM, lead, workflow — in English.',
  ].join('\n');
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

/** Trims a thread to what is worth sending, newest kept. */
export function recentTurns(messages: ChatMessage[], limit = 8): ChatMessage[] {
  return (messages ?? []).slice(-limit);
}
