import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { requireAdmin } from '@/lib/api-session';
import {
  enqueueDueScheduledActions,
  enqueueMaintenanceJobs,
  processJobs,
} from '@/lib/job-queue';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const cronSecret = request.headers.get('x-vaani-cron-secret');
  if (!process.env.CRON_SECRET || cronSecret !== process.env.CRON_SECRET) {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;
  }
  await ensureSchema();
  const queued = await enqueueDueScheduledActions();
  const maintenance = await enqueueMaintenanceJobs();
  const processed = await processJobs({ limit: 25 });
  return NextResponse.json({
    queued,
    maintenance,
    processed,
    at: new Date().toISOString(),
  });
}
