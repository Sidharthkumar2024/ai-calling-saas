import { getRawDb } from '@/db/index';
import { CONVERSION_SQL_LIST } from '@/lib/call-outcomes';
import {
  discoveryState,
  insufficientData,
  observe,
  rankRecommendations,
  recommend,
  type DiscoveryAnswers,
  type Observation,
} from '@/lib/growth-manager';
import {
  HOT_LEAD_THRESHOLD,
  offersFor,
  type ExecutedAction,
  type ExecutionContext,
  type ExecutionKind,
  type ExecutionStatus,
} from '@/lib/growth-execution';
import { templateByKey } from '@/lib/workflow-templates';
import { readConnectors } from '@/lib/growth-connector-service';
import { CONNECTORS } from '@/lib/growth-connectors';

/**
 * Turns the workspace's own data into observations (§6).
 *
 * Every number here is measured from a table this product writes during normal
 * use. There is no model call: an evidence board whose evidence is a language
 * model's impression of the data is not an evidence board.
 *
 * What §6 also asks for and is **not** built: the authorised website scan, and
 * the Google Analytics, Search Console and HubSpot connections. Those are
 * OAuth integrations with no adapter yet, and inventing observations that
 * claim to come from them would be the exact failure this module is designed
 * against. The board says which sources it has.
 */

export const CONNECTED_SOURCES = [
  'calls',
  'leads',
  'summaries',
  'objections',
  'campaigns',
  'knowledge',
] as const;

export async function growthBoard(organizationId: string) {
  const db = getRawDb();

  const [facts, profile, objections] = await Promise.all([
    db
      .prepare(
        `SELECT
           (SELECT count(*) FROM call_records WHERE organization_id = ?) AS calls,
           (SELECT count(*) FROM call_records
              WHERE organization_id = ? AND outcome IN (${CONVERSION_SQL_LIST})) AS conversions,
           (SELECT count(*) FROM call_records
              WHERE organization_id = ? AND outcome = 'not_interested') AS refused,
           (SELECT count(*) FROM call_records
              WHERE organization_id = ? AND outcome = 'transferred_to_human') AS transferred,
           (SELECT coalesce(avg(nullif(duration_seconds, 0)), 0) FROM call_records
              WHERE organization_id = ?) AS avgSeconds,
           (SELECT count(*) FROM leads WHERE organization_id = ?
              AND status NOT IN ('merged','archived')) AS leads,
           (SELECT count(*) FROM leads WHERE organization_id = ? AND score >= 75) AS hotLeads,
           (SELECT count(*) FROM summaries WHERE organization_id = ?
              AND sentiment = 'negative') AS negative,
           (SELECT count(*) FROM summaries WHERE organization_id = ?) AS summaries,
           (SELECT count(*) FROM campaigns WHERE organization_id = ?) AS campaigns,
           (SELECT count(*) FROM knowledge_sources WHERE organization_id = ?
              AND status = 'ready') AS knowledge`,
      )
      .bind(
        organizationId,
        organizationId,
        organizationId,
        organizationId,
        organizationId,
        organizationId,
        organizationId,
        organizationId,
        organizationId,
        organizationId,
        organizationId,
      )
      .first<Record<string, number>>(),
    db
      .prepare(
        `SELECT answers_json FROM business_profiles WHERE organization_id = ? LIMIT 1`,
      )
      .bind(organizationId)
      .first<{ answers_json: string }>(),
    db
      .prepare(
        `SELECT label, occurrences FROM objection_library
         WHERE organization_id = ? AND status != 'dismissed'
         ORDER BY occurrences DESC LIMIT 1`,
      )
      .bind(organizationId)
      .first<{ label: string; occurrences: number }>(),
  ]);

  const n = (key: string) => Number(facts?.[key] ?? 0);
  const calls = n('calls');
  const leads = n('leads');
  const summaries = n('summaries');

  let answers: DiscoveryAnswers = {};
  try {
    answers = JSON.parse(profile?.answers_json || '{}') as DiscoveryAnswers;
  } catch {
    answers = {};
  }

  const pct = (part: number, whole: number) =>
    whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

  // Each of these returns null when its sample is too small, and the
  // recommendations below then lose their evidence and disappear with it.
  const conversion = observe({
    id: 'conversion_rate',
    statement: `${pct(n('conversions'), calls)}% of calls reached a booking or a payment link.`,
    source: 'calls',
    metric: {
      label: 'Conversion',
      value: pct(n('conversions'), calls),
      unit: '%',
    },
    sampleSize: calls,
  });
  const refusal = observe({
    id: 'refusal_rate',
    statement: `${pct(n('refused'), calls)}% of callers said they were not interested.`,
    source: 'calls',
    metric: { label: 'Refusal', value: pct(n('refused'), calls), unit: '%' },
    sampleSize: calls,
  });
  const transfer = observe({
    id: 'transfer_rate',
    statement: `${pct(n('transferred'), calls)}% of calls were handed to a person.`,
    source: 'calls',
    metric: {
      label: 'Transfers',
      value: pct(n('transferred'), calls),
      unit: '%',
    },
    sampleSize: calls,
  });
  const duration = observe({
    id: 'avg_duration',
    statement: `The average answered call runs ${Math.round(n('avgSeconds'))} seconds.`,
    source: 'calls',
    metric: {
      label: 'Average call',
      value: Math.round(n('avgSeconds')),
      unit: 's',
    },
    sampleSize: calls,
  });
  const sentiment = observe({
    id: 'negative_sentiment',
    statement: `${pct(n('negative'), summaries)}% of analysed calls ended on a negative note.`,
    source: 'summaries',
    metric: {
      label: 'Negative',
      value: pct(n('negative'), summaries),
      unit: '%',
    },
    sampleSize: summaries,
  });
  const hot = observe({
    id: 'hot_leads',
    statement: `${n('hotLeads')} of ${leads} leads score 75 or above.`,
    source: 'leads',
    metric: { label: 'Hot leads', value: n('hotLeads') },
    sampleSize: leads,
  });
  const topObjection = objections?.label
    ? observe({
        id: 'top_objection',
        statement: `“${objections.label}” is the objection your callers raise most, heard ${objections.occurrences} times.`,
        source: 'objections',
        metric: {
          label: 'Times heard',
          value: Number(objections.occurrences ?? 0),
        },
        sampleSize: Number(objections.occurrences ?? 0),
      })
    : null;

  const observations = [
    conversion,
    refusal,
    transfer,
    duration,
    sentiment,
    hot,
    topObjection,
  ].filter(Boolean) as Observation[];

  // Evidence from the outside systems this workspace has connected (§6).
  // Reads are values, not exceptions: a connector that is down contributes its
  // reason and the rest of the board still renders.
  const connectorReads = await readConnectors(organizationId);
  for (const read of connectorReads) observations.push(...read.observations);

  const recommendations = rankRecommendations(
    [
      // Each proposal names the observations it rests on. When those are null —
      // too little data — `recommend` returns null and the advice never exists.
      conversion && conversion.metric.value < 15
        ? recommend({
            id: 'lift_conversion',
            title: 'Conversion is low for the volume you are calling',
            action:
              'Review the opening and the qualification questions in the agent studio, then A/B a second opening against the current one.',
            area: 'conversion',
            evidence: [conversion, refusal],
            priority: 90,
          })
        : null,
      topObjection
        ? recommend({
            id: 'answer_objection',
            title: 'Your most common objection has no approved answer',
            action:
              'Open Analytics › Objection library and write the answer you want agents to give. It reaches live calls immediately.',
            area: 'conversion',
            evidence: [topObjection],
            priority: 95,
          })
        : null,
      sentiment && sentiment.metric.value > 20
        ? recommend({
            id: 'sentiment_review',
            title: 'More calls than usual are ending badly',
            action:
              'Listen to a sample in AI quality assurance and check whether the agent is answering from approved knowledge.',
            area: 'quality',
            evidence: [sentiment],
            priority: 80,
          })
        : null,
      hot && n('hotLeads') > 0
        ? recommend({
            id: 'work_hot_leads',
            title: `${n('hotLeads')} leads are scoring hot and waiting`,
            action:
              'Filter the CRM to score 75 and above and assign them, or add them to a follow-up campaign.',
            area: 'follow_up',
            evidence: [hot],
            priority: 85,
          })
        : null,
      transfer && transfer.metric.value > 25
        ? recommend({
            id: 'reduce_transfers',
            title: 'A quarter of calls are reaching a person',
            action:
              'Check what callers ask before a transfer, and add the missing answers to a knowledge base.',
            area: 'coverage',
            evidence: [transfer, duration],
            priority: 70,
          })
        : null,
    ],
    observations,
  );

  return {
    discovery: { ...discoveryState(answers), answers },
    observations,
    recommendations,
    // Named honestly rather than implied: §6 asks for four more sources and
    // none of them is connected, so the board says which evidence it does not
    // have rather than letting its silence read as "nothing to report".
    sources: {
      connected: [
        ...CONNECTED_SOURCES,
        ...connectorReads
          .filter((read) => read.observations.length > 0)
          .map((read) => read.id),
      ],
      // Still named rather than implied. A source that is connected but could
      // not be read this time is neither "connected" nor "not connected", so
      // it is listed with the reason instead of quietly vanishing.
      pending: [
        { id: 'website', label: 'Website scan' },
        ...connectorReads
          .filter((read) => read.observations.length === 0)
          .map((read) => ({
            id: read.id,
            label: CONNECTORS[read.id].label,
            reason: read.reason,
          })),
      ],
    },
    notEnoughData: insufficientData({ calls, leads }),
    measuredAt: new Date().toISOString(),
  };
}

export async function saveDiscovery(input: {
  organizationId: string;
  answers: DiscoveryAnswers;
}) {
  const clean: DiscoveryAnswers = {};
  for (const [key, value] of Object.entries(input.answers ?? {}))
    if (typeof value === 'string') clean[key] = value.trim().slice(0, 2000);
  await getRawDb()
    .prepare(
      `INSERT INTO business_profiles (organization_id, answers_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(organization_id) DO UPDATE SET
         answers_json = excluded.answers_json,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(input.organizationId, JSON.stringify(clean))
    .run();
  return discoveryState(clean);
}

/**
 * Runs a website scan and stores it with its trace (§6).
 *
 * The run row is written whether the scan succeeded or not. A failed scan is
 * the more useful record of the two — it is the one somebody needs to look at
 * — and a product that only keeps its successes cannot be debugged by the
 * person using it.
 */
export async function runSiteScan(input: {
  organizationId: string;
  userId: string;
  siteUrl: string;
}) {
  const { scanSite } = await import('@/lib/site-scan');
  const result = await scanSite(input.siteUrl);
  const id = `run_${crypto.randomUUID().slice(0, 8)}`;
  await getRawDb()
    .prepare(
      `INSERT INTO growth_runs
         (id, organization_id, started_by, site_url, host, status, failure_reason,
          steps_json, pages_json, findings_json,
          high_count, medium_count, low_count, total_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.organizationId,
      input.userId,
      input.siteUrl,
      result.host ?? null,
      result.ok ? 'complete' : 'failed',
      result.reason ?? null,
      JSON.stringify(result.steps),
      JSON.stringify(result.pages),
      JSON.stringify(result.findings),
      result.counts.high,
      result.counts.medium,
      result.counts.low,
      result.totalMs,
    )
    .run();
  return { id, ...result };
}

export async function listRuns(organizationId: string, limit = 10) {
  const rows = await getRawDb()
    .prepare(
      `SELECT id, site_url AS siteUrl, host, status, failure_reason AS failureReason,
              high_count AS high, medium_count AS medium, low_count AS low,
              total_ms AS totalMs, created_at AS createdAt
       FROM growth_runs WHERE organization_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(organizationId, Math.max(1, Math.min(50, limit)))
    .all();
  return rows.results ?? [];
}

export async function getRun(organizationId: string, runId: string) {
  const row = await getRawDb()
    .prepare(
      `SELECT id, site_url AS siteUrl, host, status, failure_reason AS failureReason,
              steps_json AS steps, pages_json AS pages, findings_json AS findings,
              high_count AS high, medium_count AS medium, low_count AS low,
              total_ms AS totalMs, created_at AS createdAt
       FROM growth_runs WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(runId, organizationId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  const parse = (value: unknown) => {
    // Only a stored JSON string is worth parsing; anything else came back in a
    // shape this row is not supposed to hold.
    if (typeof value !== 'string') return [];
    try {
      return JSON.parse(value) as unknown[];
    } catch {
      return [];
    }
  };
  return {
    ...row,
    steps: parse(row.steps),
    pages: parse(row.pages),
    findings: parse(row.findings),
  };
}

/**
 * Answers a question in the growth chat (§6).
 *
 * Assembles the workspace's measured facts, hands them to the model as the only
 * figures it may quote, and stores both turns along with what the answer was
 * grounded on — so a reply can be audited later instead of taken on trust.
 */
/**
 * Everything a growth answer needs before a model is called: the thread it
 * belongs to, the system prompt with this workspace's measured facts, the
 * recent turns, and what the answer will be grounded on.
 *
 * Split out of `askGrowthManager` so the streaming route can share it exactly.
 * A second copy of this assembly would be a second prompt, and the two would
 * drift — one screen grounded on the website scan and the other not.
 */
export async function prepareGrowthAsk(input: {
  organizationId: string;
  userId: string;
  chatId?: string | null;
  question: string;
}) {
  const db = getRawDb();
  const {
    answerLanguageRule,
    buildChatContext,
    CHAT_SYSTEM_PROMPT,
    recentTurns,
  } = await import('@/lib/growth-chat');

  const board = await growthBoard(input.organizationId);
  const latest = await db
    .prepare(
      `SELECT id, host, pages_json AS pages, findings_json AS findings
       FROM growth_runs
       WHERE organization_id = ? AND status = 'complete'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(input.organizationId)
    .first<{ id: string; host: string; pages: string; findings: string }>();
  const objections = await db
    .prepare(
      `SELECT label, occurrences FROM objection_library
       WHERE organization_id = ? AND status != 'dismissed'
       ORDER BY occurrences DESC LIMIT 5`,
    )
    .bind(input.organizationId)
    .all<{ label: string; occurrences: number }>();

  const parse = (value: unknown) => {
    if (typeof value !== 'string') return [];
    try {
      return JSON.parse(value) as never[];
    } catch {
      return [];
    }
  };

  const settings = await db
    .prepare(
      `SELECT default_language FROM organization_settings WHERE organization_id = ? LIMIT 1`,
    )
    .bind(input.organizationId)
    .first<{ default_language: string | null }>();
  const workspaceLanguage = settings?.default_language ?? 'hinglish';

  const context = buildChatContext({
    answers: board.discovery.answers,
    observations: board.observations,
    scan: latest
      ? {
          host: latest.host,
          runId: latest.id,
          pages: parse(latest.pages),
          findings: parse(latest.findings),
        }
      : null,
    objections: objections.results ?? [],
    missingSources: board.sources.pending.map((source) => source.label),
  });

  // A thread is created on the first question so history has something to list.
  const chatId = input.chatId || `chat_${crypto.randomUUID().slice(0, 8)}`;
  if (!input.chatId)
    await db
      .prepare(
        `INSERT INTO growth_chats (id, organization_id, user_id, title)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(
        chatId,
        input.organizationId,
        input.userId,
        input.question.slice(0, 80),
      )
      .run();

  const history = await db
    .prepare(
      `SELECT role, content FROM growth_messages
       WHERE chat_id = ? AND organization_id = ?
       ORDER BY created_at LIMIT 20`,
    )
    .bind(chatId, input.organizationId)
    .all<{ role: 'user' | 'assistant'; content: string }>();

  return {
    chatId,
    language: workspaceLanguage,
    // The same facts the prompt was built from, unrendered, so the specialist
    // lanes can each be handed their own part of it rather than re-querying.
    slice: {
      observations: board.observations.map((observation) => ({
        source: String(observation.source),
        statement: observation.statement,
        sampleSize: observation.sampleSize,
      })),
      siteFindings: (latest
        ? (parse(latest.findings) as Array<{
            page?: string;
            title?: string;
            severity?: string;
          }>)
        : []
      ).map((finding) => ({
        page: String(finding.page ?? ''),
        title: String(finding.title ?? ''),
        severity: String(finding.severity ?? 'medium'),
      })),
      objections: (objections.results ?? []).map((objection) => ({
        label: objection.label,
        occurrences: objection.occurrences,
      })),
      missingSources: board.sources.pending.map((source) => source.label),
    },
    system: `${CHAT_SYSTEM_PROMPT}${answerLanguageRule(workspaceLanguage)}\n\n${context}`,
    messages: [
      ...recentTurns(history.results ?? []),
      { role: 'user' as const, content: input.question },
    ],
    groundedOn: {
      observations: board.observations.length,
      observationIds: board.observations.map((item) => item.id),
      scanRun: latest?.id ?? null,
      missingSourceIds: board.sources.pending.map((source) => source.id),
      missingSources: board.sources.pending.map((source) => source.label),
    },
  };
}

export type GrowthAskPlan = Awaited<ReturnType<typeof prepareGrowthAsk>>;

/**
 * Writes the question and the answer to the thread.
 *
 * Both messages go in one batch, after the answer exists: a question stored
 * before the model is called and an answer that never arrives leaves a thread
 * that reads as if the manager ignored it.
 */
export async function finishGrowthAsk(input: {
  organizationId: string;
  plan: GrowthAskPlan;
  question: string;
  answer: string;
  model: string | null;
}) {
  const db = getRawDb();
  await db.batch([
    db
      .prepare(
        `INSERT INTO growth_messages (id, chat_id, organization_id, role, content)
         VALUES (?, ?, ?, 'user', ?)`,
      )
      .bind(
        `msg_${crypto.randomUUID()}`,
        input.plan.chatId,
        input.organizationId,
        input.question.slice(0, 4000),
      ),
    db
      .prepare(
        `INSERT INTO growth_messages
           (id, chat_id, organization_id, role, content, grounded_on_json, model)
         VALUES (?, ?, ?, 'assistant', ?, ?, ?)`,
      )
      .bind(
        `msg_${crypto.randomUUID()}`,
        input.plan.chatId,
        input.organizationId,
        input.answer,
        JSON.stringify({
          observations: input.plan.groundedOn.observationIds,
          scanRun: input.plan.groundedOn.scanRun,
          missingSources: input.plan.groundedOn.missingSourceIds,
        }),
        input.model,
      ),
    db
      .prepare(
        `UPDATE growth_chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(input.plan.chatId),
  ]);
}

export async function askGrowthManager(input: {
  organizationId: string;
  userId: string;
  chatId?: string | null;
  question: string;
}) {
  const { reasonWithTools } = await import('@/lib/provider-adapters');
  const plan = await prepareGrowthAsk(input);

  let answer =
    'The growth manager is not reachable right now. Nothing was lost — ask again in a moment.';
  let model: string | null = null;
  try {
    const response = await reasonWithTools({
      organizationId: input.organizationId,
      // The workspace's own language, not whatever the model guesses from the
      // script a question happens to be typed in. A Hinglish question came
      // back in Urdu before this.
      system: plan.system,
      maxTokens: 700,
      messages: plan.messages,
    });
    const meta = response as unknown as { model?: unknown };
    model = typeof meta.model === 'string' ? meta.model : null;
    const text = ((response as { content?: unknown[] }).content ?? [])
      .filter(
        (block): block is { type: string; text: string } =>
          typeof block === 'object' &&
          block !== null &&
          (block as { type?: unknown }).type === 'text' &&
          typeof (block as { text?: unknown }).text === 'string',
      )
      .map((block) => block.text)
      .join('')
      .trim();
    if (text) answer = text;
  } catch (error) {
    // A provider outage must not lose the question or fabricate an answer.
    console.error('growth chat failed', error);
  }

  await finishGrowthAsk({
    organizationId: input.organizationId,
    plan,
    question: input.question,
    answer,
    model,
  });

  return {
    chatId: plan.chatId,
    answer,
    model,
    groundedOn: {
      observations: plan.groundedOn.observations,
      scanRun: plan.groundedOn.scanRun,
      missingSources: plan.groundedOn.missingSources,
    },
  };
}

export async function listChats(organizationId: string, limit = 20) {
  const rows = await getRawDb()
    .prepare(
      `SELECT c.id, c.title, c.updated_at AS updatedAt,
              (SELECT count(*) FROM growth_messages m WHERE m.chat_id = c.id) AS messages
       FROM growth_chats c
       WHERE c.organization_id = ?
       ORDER BY c.updated_at DESC LIMIT ?`,
    )
    .bind(organizationId, Math.max(1, Math.min(50, limit)))
    .all();
  return rows.results ?? [];
}

export async function getChat(organizationId: string, chatId: string) {
  const rows = await getRawDb()
    .prepare(
      `SELECT role, content, created_at AS createdAt
       FROM growth_messages
       WHERE chat_id = ? AND organization_id = ?
       ORDER BY created_at LIMIT 100`,
    )
    .bind(chatId, organizationId)
    .all();
  return rows.results ?? [];
}

/* ------------------------------------------------------------------ *
 * Execution (§6) — turning a recommendation into work
 * ------------------------------------------------------------------ */

/**
 * Measures what the workspace can currently support, so an offer is never
 * blocked or allowed on a guess.
 */
export async function executionContext(
  organizationId: string,
): Promise<ExecutionContext> {
  const db = getRawDb();
  const [hot, consented, agents, objection, negative, people] =
    await Promise.all([
      db
        .prepare(
          `SELECT count(*) AS n FROM leads WHERE organization_id = ? AND score >= ? AND trim(phone) != ''`,
        )
        .bind(organizationId, HOT_LEAD_THRESHOLD)
        .first<{ n: number }>(),
      // Counted here rather than discovered after the campaign exists: a hot
      // lead with no consent on record is one the dialer will refuse to call.
      db
        .prepare(
          `SELECT count(*) AS n FROM leads l WHERE l.organization_id = ? AND l.score >= ?
         AND trim(l.phone) != '' AND EXISTS (
           SELECT 1 FROM consent_records c WHERE c.organization_id = l.organization_id
             AND c.phone = l.phone AND c.status = 'granted'
             AND (c.expires_at IS NULL OR c.expires_at > CURRENT_TIMESTAMP))`,
        )
        .bind(organizationId, HOT_LEAD_THRESHOLD)
        .first<{ n: number }>(),
      db
        .prepare(
          `SELECT count(*) AS n FROM voice_agents WHERE organization_id = ? AND status = 'active'`,
        )
        .bind(organizationId)
        .first<{ n: number }>(),
      db
        .prepare(
          `SELECT label FROM objection_library WHERE organization_id = ? ORDER BY occurrences DESC LIMIT 1`,
        )
        .bind(organizationId)
        .first<{ label: string }>(),
      db
        .prepare(
          `SELECT count(*) AS n FROM call_records WHERE organization_id = ? AND sentiment = 'negative'
         AND started_at >= date('now', '-30 day')`,
        )
        .bind(organizationId)
        .first<{ n: number }>(),
      db
        .prepare(
          `SELECT count(*) AS n FROM organization_members WHERE organization_id = ?`,
        )
        .bind(organizationId)
        .first<{ n: number }>(),
    ]);
  return {
    hotLeadCount: hot?.n ?? 0,
    hotLeadsWithConsent: consented?.n ?? 0,
    hotLeadThreshold: HOT_LEAD_THRESHOLD,
    agentCount: agents?.n ?? 0,
    topObjection: objection?.label ?? null,
    negativeCallCount: negative?.n ?? 0,
    assignableCount: people?.n ?? 0,
  };
}

export async function listGrowthActions(
  organizationId: string,
): Promise<ExecutedAction[]> {
  const rows = await getRawDb()
    .prepare(
      `SELECT id, recommendation_id, kind, title, detail, status, target_type, target_id,
              created_at, completed_at
       FROM growth_actions WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`,
    )
    .bind(organizationId)
    .all<{
      id: string;
      recommendation_id: string;
      kind: string;
      title: string;
      detail: string;
      status: string;
      target_type: string | null;
      target_id: string | null;
      created_at: string;
      completed_at: string | null;
    }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    recommendationId: row.recommendation_id,
    kind: row.kind as ExecutedAction['kind'],
    title: row.title,
    detail: row.detail,
    status: row.status as ExecutedAction['status'],
    targetType: row.target_type,
    targetId: row.target_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}

export type ExecutionResult =
  | {
      ok: true;
      action: ExecutedAction;
      opened: { screen: string; id: string } | null;
    }
  | { ok: false; reason: string };

/**
 * Acts on one recommendation.
 *
 * Re-checks the block before doing anything: the board a person is looking at
 * may be minutes old, and "create a campaign from the 12 hot leads" must not
 * create an empty campaign because the last one was just called.
 */
export async function executeRecommendation(input: {
  organizationId: string;
  userId: string;
  recommendationId: string;
  kind: ExecutionKind;
}): Promise<ExecutionResult> {
  const db = getRawDb();
  const board = await growthBoard(input.organizationId);
  const recommendation = board.recommendations.find(
    (entry) => entry.id === input.recommendationId,
  );
  if (!recommendation)
    return {
      ok: false,
      reason:
        'That recommendation is no longer on the board — the numbers behind it have moved.',
    };

  const context = await executionContext(input.organizationId);
  const offer = offersFor(recommendation, context).find(
    (entry) => entry.kind === input.kind,
  );
  if (!offer)
    return {
      ok: false,
      reason: 'That is not something this recommendation offers.',
    };
  if (offer.blockedBy) return { ok: false, reason: offer.blockedBy };

  const actionId = `growthact_${crypto.randomUUID()}`;
  let targetType: string | null = null;
  let targetId: string | null = null;
  let opened: { screen: string; id: string } | null = null;
  let detail = offer.effect;

  if (input.kind === 'campaign') {
    const leads = await db
      .prepare(
        `SELECT id, name, phone FROM leads WHERE organization_id = ? AND score >= ?
         AND trim(phone) != '' ORDER BY score DESC LIMIT 500`,
      )
      .bind(input.organizationId, HOT_LEAD_THRESHOLD)
      .all<{ id: string; name: string; phone: string }>();
    const rows = leads.results ?? [];
    if (rows.length === 0)
      return {
        ok: false,
        reason: `No lead is scoring ${HOT_LEAD_THRESHOLD} or above any more, so the campaign would be empty.`,
      };

    // Consent is carried over rather than assumed. A contact whose consent is
    // not on record goes in as 'unknown', and the dialer refuses to call it —
    // marking them all granted here would launder that refusal away.
    const granted = await db
      .prepare(
        `SELECT phone FROM consent_records WHERE organization_id = ? AND status = 'granted'
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) LIMIT 10000`,
      )
      .bind(input.organizationId)
      .all<{ phone: string }>();
    const grantedPhones = new Set(
      (granted.results ?? []).map((row) => row.phone),
    );

    const agent = await db
      .prepare(
        `SELECT id FROM voice_agents WHERE organization_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`,
      )
      .bind(input.organizationId)
      .first<{ id: string }>();

    const campaignId = `campaign_${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO campaigns
        (id, organization_id, agent_id, name, status, audience_size, concurrency, retry_policy_json, calling_window_json)
        VALUES (?, ?, ?, ?, 'draft', ?, 1, ?, ?)`)
      .bind(
        campaignId,
        input.organizationId,
        agent?.id ?? null,
        `Hot leads — ${new Date().toISOString().slice(0, 10)}`,
        rows.length,
        JSON.stringify({
          attempts: 3,
          backoffMinutes: [120, 1440],
          objective: 'lead_qualification',
        }),
        JSON.stringify({
          timezone: 'Asia/Kolkata',
          start: '10:00',
          end: '19:00',
        }),
      )
      .run();
    await db.batch(
      rows.map((lead) =>
        db
          .prepare(`INSERT INTO campaign_contacts
            (id, organization_id, campaign_id, lead_id, phone, status, consent_status)
            VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
          .bind(
            `campaign_contact_${crypto.randomUUID()}`,
            input.organizationId,
            campaignId,
            lead.id,
            lead.phone,
            grantedPhones.has(lead.phone) ? 'granted' : 'unknown',
          ),
      ),
    );
    const withConsent = rows.filter((lead) =>
      grantedPhones.has(lead.phone),
    ).length;
    targetType = 'campaign';
    targetId = campaignId;
    opened = { screen: 'campaigns', id: campaignId };
    detail = `Draft campaign with ${rows.length} lead${rows.length === 1 ? '' : 's'}, ${withConsent} of them with consent on record. It is not dialling; start it from Campaigns.`;
  }

  if (input.kind === 'workflow') {
    const template = templateByKey('sales');
    if (!template)
      return { ok: false, reason: 'That workflow template is not available.' };
    const workflowId = `wf_${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO workflows
        (id, organization_id, name, description, trigger_type, status, steps_json, graph_json, template_key)
        VALUES (?, ?, ?, ?, 'outbound_campaign', 'draft', '[]', ?, ?)`)
      .bind(
        workflowId,
        input.organizationId,
        template.name,
        template.flow,
        JSON.stringify(template.graph),
        template.key,
      )
      .run();
    targetType = 'workflow';
    targetId = workflowId;
    opened = { screen: 'workflows', id: workflowId };
    detail =
      'Installed as a draft. Open it, point the object search and queue at your own configuration, then publish.';
  }

  if (input.kind === 'task') detail = offer.effect;

  await db
    .prepare(`INSERT INTO growth_actions
      (id, organization_id, recommendation_id, kind, title, detail, status, target_type, target_id, evidence_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`)
    .bind(
      actionId,
      input.organizationId,
      recommendation.id,
      input.kind,
      recommendation.title,
      detail.slice(0, 600),
      targetType,
      targetId,
      JSON.stringify(recommendation.evidence),
      input.userId,
    )
    .run();

  return {
    ok: true,
    opened,
    action: {
      id: actionId,
      recommendationId: recommendation.id,
      kind: input.kind,
      title: recommendation.title,
      detail,
      status: 'open',
      targetType,
      targetId,
      createdAt: new Date().toISOString(),
      completedAt: null,
    },
  };
}

export async function updateGrowthAction(input: {
  organizationId: string;
  actionId: string;
  status: ExecutionStatus;
}) {
  const result = await getRawDb()
    .prepare(`UPDATE growth_actions SET status = ?,
      completed_at = CASE WHEN ? = 'done' THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE id = ? AND organization_id = ?`)
    .bind(input.status, input.status, input.actionId, input.organizationId)
    .run();
  return { ok: (result.meta?.changes ?? 0) > 0 };
}
