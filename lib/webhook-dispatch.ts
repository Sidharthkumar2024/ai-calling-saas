import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { decryptSecret } from '@/lib/security';
import { enqueueJob } from '@/lib/job-queue';

const encoder = new TextEncoder();

export async function dispatchWebhook(
  organizationId: string,
  eventType: string,
  data: Record<string, unknown>,
) {
  await ensureSchema();
  const db = getRawDb();
  const endpoints = await db
    .prepare(
      `SELECT id, url, encrypted_secret, events_json
       FROM webhook_endpoints
       WHERE organization_id = ? AND status = 'active'`,
    )
    .bind(organizationId)
    .all<{
      id: string;
      url: string;
      encrypted_secret: string;
      events_json: string;
    }>();
  const payload = JSON.stringify({
    id: `event_${crypto.randomUUID()}`,
    type: eventType,
    createdAt: new Date().toISOString(),
    data,
  });

  await Promise.allSettled(
    endpoints.results
      .filter((endpoint) => {
        const events = JSON.parse(endpoint.events_json) as string[];
        return events.includes(eventType);
      })
      .map(async (endpoint) => {
        const timestamp = Math.floor(Date.now() / 1000);
        const secret = await decryptSecret(endpoint.encrypted_secret);
        const signature = await sign(`${timestamp}.${payload}`, secret);
        let statusCode: number | null = null;
        let responseSnippet = '';
        try {
          const response = await fetch(endpoint.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-vaani-event': eventType,
              'x-vaani-signature': `t=${timestamp},v1=${signature}`,
            },
            body: payload,
            signal: AbortSignal.timeout(5_000),
          });
          statusCode = response.status;
          responseSnippet = (await response.text()).slice(0, 500);
          await db
            .prepare(
              `UPDATE webhook_endpoints SET
                 last_delivery_at = CURRENT_TIMESTAMP,
                 failure_count = CASE WHEN ? BETWEEN 200 AND 299 THEN 0 ELSE failure_count + 1 END
               WHERE id = ?`,
            )
            .bind(statusCode, endpoint.id)
            .run();
          if (statusCode < 200 || statusCode >= 300) {
            await enqueueJob({
              organizationId,
              queue: 'webhooks',
              type: 'webhook.deliver',
              idempotencyKey: `webhook:${endpoint.id}:${eventType}:${await fingerprint(payload)}`,
              payload: { endpointId: endpoint.id, eventType, payload },
              maxAttempts: 8,
            });
          }
        } catch (error) {
          responseSnippet = error instanceof Error ? error.message : 'Delivery failed';
          await db
            .prepare('UPDATE webhook_endpoints SET failure_count = failure_count + 1 WHERE id = ?')
            .bind(endpoint.id)
            .run();
          await enqueueJob({
            organizationId,
            queue: 'webhooks',
            type: 'webhook.deliver',
            idempotencyKey: `webhook:${endpoint.id}:${eventType}:${await fingerprint(payload)}`,
            payload: { endpointId: endpoint.id, eventType, payload },
            maxAttempts: 8,
          });
        }
        await db
          .prepare(
            `INSERT INTO webhook_deliveries
             (id, endpoint_id, event_type, status_code, attempt, response_snippet)
             VALUES (?, ?, ?, ?, 1, ?)`,
          )
          .bind(
            `delivery_${crypto.randomUUID()}`,
            endpoint.id,
            eventType,
            statusCode,
            responseSnippet,
          )
          .run();
      }),
  );
}

async function fingerprint(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
