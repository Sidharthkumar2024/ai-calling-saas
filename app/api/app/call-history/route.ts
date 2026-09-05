import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import {
  boundedPage,
  buildWhere,
  emptyKind,
  isFiltered,
  parseFilters,
  rangeLabel,
  totalPages,
} from '@/lib/call-history';

export const dynamic = 'force-dynamic';

/**
 * Filtered, paged call history (§19).
 *
 * The list this replaces was `ORDER BY started_at DESC LIMIT 100` with no
 * filters and no total, so a workspace with four thousand calls saw a hundred
 * and had no way to know the rest existed.
 *
 * The filter options are read out of the workspace's own rows rather than
 * declared here. `outcome` in this database holds two vocabularies written at
 * different times plus free prose from an older path; a list I hardcoded would
 * quietly hide every row whose outcome I failed to predict, and the screen
 * would look complete while being wrong.
 */
export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'analytics.view');
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const db = getRawDb();
  const params = new URL(request.url).searchParams;
  const filters = parseFilters(params);
  const { limit, offset, page } = boundedPage({
    page: params.get('page'),
    pageSize: params.get('pageSize'),
  });
  const where = buildWhere(organizationId, filters);

  // The transcript join is needed by the transcript filter and by the row's
  // own "has a transcript" flag, so it is in both queries.
  const from = `FROM call_records c
    LEFT JOIN voice_agents a ON a.id = c.agent_id
    LEFT JOIN campaigns m ON m.id = c.campaign_id
    LEFT JOIN transcripts t ON t.call_id = c.id`;

  const [rows, count, totals] = await Promise.all([
    db
      .prepare(`SELECT c.id, c.direction, c.channel, c.from_number, c.to_number,
        c.customer_name, c.status, c.outcome, c.duration_seconds, c.latency_ms,
        c.sentiment, c.recording_status, c.cost_credits, c.started_at, c.ended_at,
        a.name AS agent_name, m.name AS campaign_name,
        CASE WHEN trim(coalesce(t.full_text, '')) != '' THEN 1 ELSE 0 END AS has_transcript
        ${from} WHERE ${where.sql} ORDER BY c.started_at DESC LIMIT ? OFFSET ?`)
      .bind(...where.bindings, limit, offset)
      .all(),
    db
      .prepare(`SELECT count(*) AS n ${from} WHERE ${where.sql}`)
      .bind(...where.bindings)
      .first<{ n: number }>(),
    // Totals for what the filter selected, not for the whole workspace —
    // otherwise a filtered view shows a cost that belongs to other calls.
    db
      .prepare(`SELECT coalesce(sum(c.cost_credits), 0) AS credits,
          coalesce(sum(c.duration_seconds), 0) AS seconds ${from} WHERE ${where.sql}`)
      .bind(...where.bindings)
      .first<{ credits: number; seconds: number }>(),
  ]);

  const total = count?.n ?? 0;
  const returned = rows.results?.length ?? 0;
  const filtered = isFiltered(filters);

  return NextResponse.json({
    calls: rows.results ?? [],
    page,
    pageSize: limit,
    total,
    totalPages: totalPages(total, limit),
    range: rangeLabel({ page, limit, returned, total }),
    empty: emptyKind({ total, filtered }),
    filtered,
    selection: {
      credits: Math.round(Number(totals?.credits ?? 0)),
      seconds: Math.round(Number(totals?.seconds ?? 0)),
    },
    options: await filterOptions(organizationId),
  });
}

/**
 * The choices, read from the workspace's own rows.
 *
 * An outcome nobody in this workspace has ever recorded is not offered, and an
 * outcome this build has never heard of still is — because it is in the data,
 * and a filter that cannot reach a row that exists is a broken filter.
 */
async function filterOptions(organizationId: string) {
  const db = getRawDb();
  const [outcomes, channels, directions, sentiments, agents, campaigns] =
    await Promise.all([
      distinct(organizationId, 'outcome'),
      distinct(organizationId, 'channel'),
      distinct(organizationId, 'direction'),
      distinct(organizationId, 'sentiment'),
      db
        .prepare(
          `SELECT id, name FROM voice_agents WHERE organization_id = ? ORDER BY name LIMIT 100`,
        )
        .bind(organizationId)
        .all<{ id: string; name: string }>(),
      db
        .prepare(
          `SELECT id, name FROM campaigns WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100`,
        )
        .bind(organizationId)
        .all<{ id: string; name: string }>(),
    ]);
  return {
    outcomes,
    channels,
    directions,
    sentiments,
    agents: agents.results ?? [],
    campaigns: campaigns.results ?? [],
  };
}

/** Column names here are literals in this file, never anything from a request. */
async function distinct(organizationId: string, column: string) {
  const rows = await getRawDb()
    .prepare(`SELECT DISTINCT ${column} AS value FROM call_records
      WHERE organization_id = ? AND ${column} IS NOT NULL AND trim(${column}) != ''
      ORDER BY value LIMIT 60`)
    .bind(organizationId)
    .all<{ value: string }>();
  return (rows.results ?? []).map((row) => row.value);
}
