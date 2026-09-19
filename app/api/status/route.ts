import { NextResponse } from 'next/server';
import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { healthReport } from '@/lib/health-center';
import { rollUp } from '@/lib/service-health';
import {
  publicComponents,
  applyStatusUpdates,
  type StatusUpdate,
} from '@/lib/public-status';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    await ensureSchema();
    const [report, rows] = await Promise.all([
      healthReport(),
      getRawDb()
        .prepare(
          `SELECT id, component, title, message, state, starts_at, ends_at, updated_at FROM public_status_updates WHERE state != 'resolved' OR updated_at >= datetime('now', '-30 days') ORDER BY updated_at DESC LIMIT 100`,
        )
        .all<StatusUpdate>(),
    ]);
    const updates = rows.results ?? [];
    const components = applyStatusUpdates(
      publicComponents(report.components),
      updates,
    );
    return NextResponse.json(
      {
        overall: rollUp(components.map((c) => c.state)),
        components,
        updates,
        measuredAt: report.measuredAt,
        windowMinutes: report.windowMinutes,
      },
      { headers: { 'Cache-Control': 'public, max-age=30' } },
    );
  } catch {
    return NextResponse.json(
      {
        overall: 'unknown',
        components: publicComponents([]),
        updates: [],
        measuredAt: new Date().toISOString(),
        error: 'Status measurements are temporarily unavailable.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
