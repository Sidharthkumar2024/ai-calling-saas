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
export const PENDING_SOURCES = [
  { id: 'website', label: 'Website scan' },
  { id: 'google_analytics', label: 'Google Analytics' },
  { id: 'search_console', label: 'Search Console' },
  { id: 'hubspot', label: 'HubSpot' },
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
      connected: CONNECTED_SOURCES,
      pending: PENDING_SOURCES,
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
