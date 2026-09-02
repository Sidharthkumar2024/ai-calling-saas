import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';

export const dynamic = 'force-dynamic';

/**
 * Report runs: list them, or download one as CSV with `?run=<id>&format=csv`.
 * Reports previously produced no artefact at all.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireCustomerPermission(request, 'analytics.view');
  if (auth.response) return auth.response;
  const { id } = await context.params;
  const url = new URL(request.url);
  const runId = (url.searchParams.get('run') ?? '').trim();
  const db = getRawDb();
  const organizationId = auth.session.organizationId;

  const definition = await db
    .prepare(`SELECT id, name, report_type, schedule, status, last_generated_at
      FROM report_definitions WHERE id = ? AND organization_id = ? LIMIT 1`)
    .bind(id, organizationId)
    .first<{ id: string; name: string; report_type: string }>();
  if (!definition)
    return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

  if (runId) {
    const run = await db
      .prepare(`SELECT id, status, report_type, window_days, row_count,
          summary_json, content_csv, bytes, created_at
        FROM report_runs WHERE id = ? AND report_id = ? AND organization_id = ? LIMIT 1`)
      .bind(runId, id, organizationId)
      .first<{
        id: string;
        content_csv: string;
        row_count: number;
        created_at: string;
      }>();
    if (!run)
      return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
    if (url.searchParams.get('format') === 'csv') {
      await recordAudit(auth.session, 'report.downloaded', 'report', id, {
        runId,
        rows: run.row_count,
      });
      const filename = `${definition.name.replaceAll(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-${run.created_at.slice(0, 10)}.csv`;
      return new NextResponse(run.content_csv, {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${filename}"`,
          'cache-control': 'private, no-store',
        },
      });
    }
    return NextResponse.json({ report: definition, run });
  }

  const runs = await db
    .prepare(`SELECT id, status, report_type, window_days, row_count,
        summary_json, bytes, error, created_at
      FROM report_runs WHERE report_id = ? AND organization_id = ?
      ORDER BY created_at DESC LIMIT 20`)
    .bind(id, organizationId)
    .all();
  return NextResponse.json({ report: definition, runs: runs.results ?? [] });
}
