import { getRawDb } from '@/db/index';
import { reasonWithTools } from '@/lib/provider-adapters';

/**
 * AI co-pilot for human agents (blueprint §4).
 *
 * When a human takes over, they arrive with no context beyond the handoff
 * summary. This reads the actual conversation and suggests what to say next.
 *
 * Suggestions are cached per transcript length: the Agent Desk polls, and
 * without the cache every refresh would bill another model call for an
 * unchanged conversation.
 */

export type Copilot = {
  goal: string;
  facts: string[];
  suggestions: string[];
  risks: string[];
  nextAction: string;
  turnCount: number;
  model: string | null;
  cached: boolean;
  available: boolean;
  reason?: string;
};

function jsonArray(raw: string | null | undefined) {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

export async function copilotForHandoff(input: {
  organizationId: string;
  handoffId: string;
}): Promise<Copilot> {
  const db = getRawDb();
  const handoff = await db
    .prepare(`SELECT id, call_id, session_id, reason, ai_summary, skill, language
      FROM handoffs WHERE id = ? AND organization_id = ? LIMIT 1`)
    .bind(input.handoffId, input.organizationId)
    .first<{
      id: string;
      call_id: string | null;
      session_id: string | null;
      reason: string;
      ai_summary: string | null;
      skill: string | null;
      language: string | null;
    }>();
  const empty: Copilot = {
    goal: '',
    facts: [],
    suggestions: [],
    risks: [],
    nextAction: '',
    turnCount: 0,
    model: null,
    cached: false,
    available: false,
  };
  if (!handoff) return { ...empty, reason: 'handoff_not_found' };

  // A playground handoff carries no call id; its call record is derived from
  // the session id the same way the telemetry writer derives it.
  const callId =
    handoff.call_id ??
    (handoff.session_id ? `call_${handoff.session_id}` : null);
  if (!callId) return { ...empty, reason: 'no_conversation_linked' };

  const turns = await db
    .prepare(
      `SELECT role, content FROM call_turns WHERE call_id = ? ORDER BY turn_index`,
    )
    .bind(callId)
    .all<{ role: string; content: string }>();
  const rows = turns.results ?? [];
  if (!rows.length) return { ...empty, reason: 'no_transcript_yet' };

  const cached = await db
    .prepare(`SELECT goal, facts_json, suggestions_json, risks_json, next_action, model
      FROM copilot_suggestions
      WHERE handoff_id = ? AND turn_count = ? LIMIT 1`)
    .bind(input.handoffId, rows.length)
    .first<{
      goal: string | null;
      facts_json: string;
      suggestions_json: string;
      risks_json: string;
      next_action: string | null;
      model: string | null;
    }>();
  if (cached)
    return {
      goal: cached.goal ?? '',
      facts: jsonArray(cached.facts_json),
      suggestions: jsonArray(cached.suggestions_json),
      risks: jsonArray(cached.risks_json),
      nextAction: cached.next_action ?? '',
      turnCount: rows.length,
      model: cached.model,
      cached: true,
      available: true,
    };

  const transcript = rows
    .map(
      (turn) =>
        `${turn.role === 'customer' ? 'Customer' : 'Agent'}: ${turn.content}`,
    )
    .join('\n')
    .slice(-8000);

  const system = `You assist a human support agent who has just taken over a live conversation.
Return ONLY minified JSON:
{"goal":string,"facts":string[],"suggestions":string[],"risks":string[],"next_action":string}
Rules: base everything on the transcript only. "suggestions" are up to three short lines the agent could say next, written in the customer's own language. "facts" are concrete details the customer gave (names, amounts, dates, references). "risks" are policy or promise risks — an unconfirmed refund, a commitment the agent should not make, a request for sensitive card details. Never invent an order id, amount or policy.`;

  try {
    const response = await reasonWithTools({
      organizationId: input.organizationId,
      system,
      maxTokens: 600,
      messages: [
        {
          role: 'user',
          content: `Handoff reason: ${handoff.reason}\nAI summary: ${
            handoff.ai_summary ?? 'none'
          }\n\nTranscript (${rows.length} turns):\n${transcript}`,
        },
      ],
    });
    const blocks = ((response as { content?: unknown[] }).content ??
      []) as Array<{ type?: string; text?: string }>;
    const text = blocks
      .filter(
        (block) => block.type === 'text' && typeof block.text === 'string',
      )
      .map((block) => block.text as string)
      .join('')
      .trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start)
      return { ...empty, turnCount: rows.length, reason: 'unparsed_output' };
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    const list = (key: string) =>
      Array.isArray(parsed[key])
        ? (parsed[key] as unknown[]).map((item) => String(item)).slice(0, 5)
        : [];
    const meta = response as unknown as { model?: unknown };
    const model = typeof meta.model === 'string' ? meta.model : null;
    const result: Copilot = {
      goal: typeof parsed.goal === 'string' ? parsed.goal : '',
      facts: list('facts'),
      suggestions: list('suggestions'),
      risks: list('risks'),
      nextAction:
        typeof parsed.next_action === 'string' ? parsed.next_action : '',
      turnCount: rows.length,
      model,
      cached: false,
      available: true,
    };
    await db
      .prepare(`INSERT INTO copilot_suggestions
        (id, organization_id, handoff_id, call_id, turn_count, goal, facts_json,
         suggestions_json, risks_json, next_action, model)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(handoff_id, turn_count) DO NOTHING`)
      .bind(
        `copilot_${crypto.randomUUID()}`,
        input.organizationId,
        input.handoffId,
        callId,
        rows.length,
        result.goal,
        JSON.stringify(result.facts),
        JSON.stringify(result.suggestions),
        JSON.stringify(result.risks),
        result.nextAction,
        model,
      )
      .run();
    return result;
  } catch (error) {
    // No reasoning provider, or the provider failed: say so rather than
    // showing an empty card that looks like "nothing to suggest".
    return {
      ...empty,
      turnCount: rows.length,
      reason:
        error instanceof Error
          ? `provider_unavailable: ${error.message.slice(0, 120)}`
          : 'provider_unavailable',
    };
  }
}
