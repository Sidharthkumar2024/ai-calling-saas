import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';

export const dynamic = 'force-dynamic';

export async function GET() {
  await ensureSchema();
  const providers = await getRawDb()
    .prepare(`SELECT provider, display_name, button_visible, enabled, status
      FROM auth_provider_settings WHERE button_visible = 1 ORDER BY display_name`)
    .all();
  return NextResponse.json({ providers: providers.results });
}
