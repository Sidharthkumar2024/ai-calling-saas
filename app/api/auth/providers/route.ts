import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { googleAuthConfig } from '@/lib/google-auth-config';

export const dynamic = 'force-dynamic';

export async function GET() {
  await ensureSchema();
  const providers = await getRawDb()
    .prepare(`SELECT provider, display_name, button_visible, enabled, status
      FROM auth_provider_settings WHERE button_visible = 1 ORDER BY display_name`)
    .all();
  const googleReady = Boolean(await googleAuthConfig());
  return NextResponse.json(
    {
      providers: providers.results.map((provider) =>
        provider.provider === 'google' && provider.enabled && !googleReady
          ? { ...provider, enabled: 0, status: 'credentials_required' }
          : provider,
      ),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
