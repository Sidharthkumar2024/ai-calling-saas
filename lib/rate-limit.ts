import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { sha256 } from '@/lib/security';

export async function enforceRateLimit(input: {
  namespace: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
  blockSeconds?: number;
}) {
  await ensureSchema();
  const key = await sha256(
    `${input.namespace}:${input.identifier.toLowerCase()}`,
  );
  const db = getRawDb();
  const now = new Date();
  const row = await db
    .prepare(`SELECT count, window_started_at, blocked_until FROM rate_limit_buckets
    WHERE bucket_key = ?`)
    .bind(key)
    .first<{
      count: number;
      window_started_at: string;
      blocked_until: string | null;
    }>();
  if (row?.blocked_until && new Date(row.blocked_until) > now) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(
        (new Date(row.blocked_until).getTime() - now.getTime()) / 1000,
      ),
    };
  }
  const windowExpired =
    !row ||
    now.getTime() - new Date(row.window_started_at).getTime() >=
      input.windowSeconds * 1000;
  const nextCount = windowExpired ? 1 : row.count + 1;
  const blockedUntil =
    nextCount > input.limit
      ? new Date(
          now.getTime() + (input.blockSeconds || input.windowSeconds) * 1000,
        ).toISOString()
      : null;
  await db
    .prepare(`INSERT INTO rate_limit_buckets (bucket_key, count, window_started_at, blocked_until, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(bucket_key) DO UPDATE SET count=excluded.count, window_started_at=excluded.window_started_at,
      blocked_until=excluded.blocked_until, updated_at=CURRENT_TIMESTAMP`)
    .bind(
      key,
      nextCount,
      windowExpired ? now.toISOString() : row!.window_started_at,
      blockedUntil,
    )
    .run();
  return {
    allowed: nextCount <= input.limit,
    remaining: Math.max(0, input.limit - nextCount),
    retryAfterSeconds: blockedUntil
      ? input.blockSeconds || input.windowSeconds
      : 0,
  };
}

export function requestFingerprint(request: Request, suffix = '') {
  const forwarded =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return `${forwarded || 'local'}:${suffix}`;
}
