import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { entitlementAccess } from '@/lib/order-engine';
import { enforceRateLimit, requestFingerprint } from '@/lib/rate-limit';
import { sha256 } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * Digital delivery (§9).
 *
 * The customer-facing end of the gate. A link exists from the moment the order
 * is placed and does nothing until the payment provider's *signed* webhook says
 * the money arrived — so possessing the URL is not the same as having paid.
 *
 * Unauthenticated by design: the buyer has no account. The token is the
 * credential, which is why the row stores only its hash, the endpoint is rate
 * limited against guessing, and every open is counted.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  await ensureSchema();

  // Tokens are 64 hex characters. Rate limiting is per caller, not per token,
  // because the thing being stopped is someone trying many tokens.
  const limit = await enforceRateLimit({
    namespace: 'delivery',
    identifier: requestFingerprint(request),
    limit: 30,
    windowSeconds: 60,
  });
  if (!limit.allowed)
    return NextResponse.json(
      { error: 'Too many attempts. Wait a minute and try again.' },
      { status: 429 },
    );

  const db = getRawDb();
  const row = await db
    .prepare(
      `SELECT id, asset_url, title, status, expires_at, download_count, max_downloads
       FROM entitlements WHERE token_hash = ? LIMIT 1`,
    )
    .bind(await sha256(String(token ?? '')))
    .first<{
      id: string;
      asset_url: string;
      title: string | null;
      status: string;
      expires_at: string | null;
      download_count: number;
      max_downloads: number | null;
    }>();

  const access = entitlementAccess(row);
  if (!access.allowed)
    return NextResponse.json(
      { error: access.message, reason: access.reason },
      { status: access.status },
    );

  // Counted before the redirect, so a download that is never followed still
  // spends its attempt — the alternative is a counter that can be avoided by
  // closing the tab.
  await db
    .prepare(
      `UPDATE entitlements SET download_count = download_count + 1 WHERE id = ?`,
    )
    .bind(row!.id)
    .run();

  return NextResponse.redirect(row!.asset_url, 302);
}
