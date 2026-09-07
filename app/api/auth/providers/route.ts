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
  const googleReady = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
  return NextResponse.json({ providers: providers.results.map((provider) => provider.provider === 'google' && provider.enabled && !googleReady ? { ...provider, enabled: 0, status: 'credentials_required' } : provider) }, { headers: { 'Cache-Control': 'no-store' } });
}
