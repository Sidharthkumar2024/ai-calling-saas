import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { intakeWhatsAppDocument } from '@/lib/document-inbox';
import { whatsAppInboundCredentials } from '@/lib/commerce';
import { readPlatformSecret } from '@/lib/platform-secrets';

export const dynamic = 'force-dynamic';

/**
 * WhatsApp Cloud API webhook (Part 3.2).
 *
 * Two things guard this endpoint, and both matter because anyone can POST to
 * it. Meta signs every delivery with the app secret, and the signature is
 * verified before the body is read as anything but bytes. Then the phone
 * number the message arrived on decides which workspace it belongs to —
 * never a tenant id in the payload, which is a claim by whoever sent it.
 *
 * The GET half is Meta's subscription handshake, which echoes a challenge
 * only when the verify token matches.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  await ensureSchema();
  const platform = await readPlatformSecret('whatsapp');
  const expected = platform.secrets.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN;
  if (
    expected &&
    params.get('hub.mode') === 'subscribe' &&
    params.get('hub.verify_token') === expected
  )
    return new Response(params.get('hub.challenge') ?? '', { status: 200 });
  return new Response('Forbidden', { status: 403 });
}

export async function POST(request: Request) {
  await ensureSchema();
  const raw = await request.text();
  const signature = request.headers.get('x-hub-signature-256') ?? '';
  const platform = await readPlatformSecret('whatsapp');
  const appSecret = platform.secrets.appSecret || process.env.WHATSAPP_APP_SECRET;
  if (!appSecret)
    // Refused rather than trusted. An unverifiable webhook that writes files
    // into a workspace is worse than one that does not run.
    return NextResponse.json(
      { error: 'WhatsApp webhook verification is not configured.' },
      { status: 503 },
    );
  if (!(await signatureValid(raw, signature, appSecret)))
    return NextResponse.json({ error: 'Signature mismatch.' }, { status: 401 });

  let payload: WebhookBody;
  try {
    payload = JSON.parse(raw) as WebhookBody;
  } catch {
    return NextResponse.json({ error: 'Unreadable body.' }, { status: 400 });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      // The number the message landed on identifies the tenant. Nothing in
      // the payload gets to say which workspace this is.
      const credentials = await whatsAppInboundCredentials(phoneNumberId);
      if (!credentials) {
        results.push({
          phoneNumberId,
          skipped: 'no_workspace_for_this_number',
        });
        continue;
      }
      for (const message of value?.messages ?? []) {
        const messageType = message.type ?? (message.text ? 'text' : 'unknown');
        const messageBody = message.text?.body ?? null;
        const media =
          message.image ?? message.document ?? message.video ?? message.audio;
        const mediaId = media?.id ?? null;
        const waMessageId = message.id;
        if (waMessageId && message.from) {
          await dbInsertInboxMessage({
            organizationId: credentials.organizationId,
            phoneNumberId,
            waMessageId,
            senderPhone: message.from,
            messageType,
            body: messageBody,
            mediaId,
          });
        }
        if (!media?.id) continue;
        const result = await intakeWhatsAppDocument({
          organizationId: credentials.organizationId,
          mediaId: media.id,
          mimeType: media.mime_type ?? '',
          sizeBytes: Number(media.file_size ?? 0),
          filename: media.filename ?? null,
          fromPhone: message.from ?? '',
          accessToken: credentials.accessToken,
          graphVersion: credentials.graphVersion,
        });
        results.push({
          mediaId: media.id,
          ok: result.ok,
          reason: result.ok ? null : result.reason,
        });
      }
    }
  }

  // Meta retries anything that is not a 200, so a file this workspace refused
  // on purpose must not look like a delivery failure.
  return NextResponse.json({ received: results.length, results });
}

async function dbInsertInboxMessage(input: {
  organizationId: string;
  phoneNumberId: string;
  waMessageId: string;
  senderPhone: string;
  messageType: string;
  body: string | null;
  mediaId: string | null;
}) {
  const { getRawDb } = await import('@/db/index');
  const db = getRawDb();
  await db
    .prepare(`INSERT OR IGNORE INTO whatsapp_messages
      (id, organization_id, phone_number_id, wa_message_id, direction,
       sender_phone, message_type, body, media_id)
      VALUES (?, ?, ?, ?, 'inbound', ?, ?, ?, ?)`)
    .bind(
      `wam_${crypto.randomUUID()}`,
      input.organizationId,
      input.phoneNumberId,
      input.waMessageId,
      input.senderPhone,
      input.messageType,
      input.body,
      input.mediaId,
    )
    .run();
}

async function signatureValid(body: string, header: string, secret: string) {
  const provided = header.replace(/^sha256=/, '').trim();
  if (!/^[a-f0-9]{64}$/i.test(provided)) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const expected = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  // Constant-time compare: a length-and-bytes check that returns early leaks
  // how much of a forged signature was right.
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1)
    diff |=
      expected.charCodeAt(index) ^ provided.toLowerCase().charCodeAt(index);
  return diff === 0;
}

type WebhookMedia = {
  id?: string;
  mime_type?: string;
  file_size?: number;
  filename?: string;
};

type WebhookBody = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: Array<{
          id?: string;
          type?: string;
          from?: string;
          text?: { body?: string };
          image?: WebhookMedia;
          document?: WebhookMedia;
          video?: WebhookMedia;
          audio?: WebhookMedia;
        }>;
      };
    }>;
  }>;
};
