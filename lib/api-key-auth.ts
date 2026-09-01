import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { sha256 } from '@/lib/security';

export async function authenticateApiKey(request: Request, requiredScope: string) {
  await ensureSchema();
  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : null;
  if (!token || !token.startsWith('vaani_live_')) return null;
  const row = await getRawDb()
    .prepare(
      `SELECT id, organization_id, scopes_json FROM api_credentials
       WHERE key_hash = ? AND revoked_at IS NULL LIMIT 1`,
    )
    .bind(await sha256(token))
    .first<{ id: string; organization_id: string; scopes_json: string }>();
  if (!row) return null;
  const scopes = JSON.parse(row.scopes_json) as string[];
  if (!scopes.includes(requiredScope)) return null;
  await getRawDb()
    .prepare('UPDATE api_credentials SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(row.id)
    .run();
  return { apiKeyId: row.id, organizationId: row.organization_id, scopes };
}
