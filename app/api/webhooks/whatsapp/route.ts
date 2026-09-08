import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { intakeWhatsAppDocument } from '@/lib/document-inbox';
import { whatsAppInboundCredentials } from '@/lib/commerce';
import { readPlatformSecret } from '@/lib/platform-secrets';
import { dispatchInboundMessage } from '@/lib/whatsapp-bot';
import { parseFlowReply } from '@/lib/whatsapp-flows';

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
  const expected =
    platform.secrets.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN;
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
  const appSecret =
    platform.secrets.appSecret || process.env.WHATSAPP_APP_SECRET;
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
          const stored = await dbInsertInboxMessage({
            organizationId: credentials.organizationId,
            phoneNumberId,
            waMessageId,
            senderPhone: message.from,
            messageType,
            body: messageBody,
            mediaId,
          });
          // Hand it to a workflow, if this workspace published one and no
          // colleague has claimed the conversation. Whether the row was new
          // decides it: Meta retries a webhook it did not get a 200 from, and
          // answering the same message twice is the mistake that shows.
          const verdict = await dispatchInboundMessage({
            organizationId: credentials.organizationId,
            phone: message.from,
            message: {
              messageType,
              body: messageBody,
              isNew: stored.inserted,
              assignedAgentId: stored.assignedAgentId,
            },
          });
          if (verdict.acted !== 'none')
            results.push({ waMessageId, bot: verdict.acted });
        }
        // A completed Flow. The answers arrive in one piece rather than as a
        // conversation, which is the whole point of asking with a form.
        const flowReply =
          message.interactive?.type === 'nfm_reply'
            ? parseFlowReply(message.interactive.nfm_reply)
            : null;
        if (flowReply) {
          const recorded = await dbRecordFlowAnswers({
            organizationId: credentials.organizationId,
            flowToken: flowReply.flowToken,
            phone: message.from ?? '',
            answers: flowReply.answers,
          });
          results.push({ waMessageId, flow: recorded });
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

/**
 * Stores an inbound message, and reports two things the caller needs.
 *
 * `inserted` is read back rather than taken from the driver's change count:
 * `INSERT OR IGNORE` reports zero changes for a duplicate on every driver, but
 * the envelope that carries the count differs between D1 and node:sqlite, and
 * this decides whether a bot speaks.
 */
async function dbInsertInboxMessage(input: {
  organizationId: string;
  phoneNumberId: string;
  waMessageId: string;
  senderPhone: string;
  messageType: string;
  body: string | null;
  mediaId: string | null;
}): Promise<{ inserted: boolean; assignedAgentId: string | null }> {
  const { getRawDb } = await import('@/db/index');
  const db = getRawDb();
  const id = `wam_${crypto.randomUUID()}`;
  await db
    .prepare(`INSERT OR IGNORE INTO whatsapp_messages
      (id, organization_id, phone_number_id, wa_message_id, direction,
       sender_phone, message_type, body, media_id)
      VALUES (?, ?, ?, ?, 'inbound', ?, ?, ?, ?)`)
    .bind(
      id,
      input.organizationId,
      input.phoneNumberId,
      input.waMessageId,
      input.senderPhone,
      input.messageType,
      input.body,
      input.mediaId,
    )
    .run();
  const stored = await db
    .prepare(
      `SELECT id FROM whatsapp_messages WHERE organization_id = ? AND wa_message_id = ? LIMIT 1`,
    )
    .bind(input.organizationId, input.waMessageId)
    .first<{ id: string }>();
  const held = await db
    .prepare(
      `SELECT support_agent_id FROM whatsapp_assignments WHERE organization_id = ? AND phone IN (?, ?) LIMIT 1`,
    )
    .bind(
      input.organizationId,
      input.senderPhone,
      `+${input.senderPhone.replace(/\D/g, '')}`,
    )
    .first<{ support_agent_id: string | null }>();
  return {
    inserted: stored?.id === id,
    assignedAgentId: held?.support_agent_id ?? null,
  };
}

/**
 * Stores the answers a customer filled in.
 *
 * Matched on the token this workspace generated when it sent the form, not on
 * the number: the same person can be sent two different forms, and a number
 * alone cannot say which one came back.
 *
 * An answer with no matching row is recorded anyway rather than dropped — it
 * means a send this workspace did not write down, which is worth being able to
 * see — and it is scoped to the workspace whose number received it, so one
 * tenant's token can never claim another's row.
 */
async function dbRecordFlowAnswers(input: {
  organizationId: string;
  flowToken: string;
  phone: string;
  answers: Record<string, string>;
}): Promise<'matched' | 'unmatched' | 'duplicate'> {
  const { getRawDb } = await import('@/db/index');
  const db = getRawDb();
  const answers = JSON.stringify(input.answers);
  if (input.flowToken) {
    const existing = await db
      .prepare(
        `SELECT id, status FROM whatsapp_flow_responses WHERE organization_id = ? AND flow_token = ? LIMIT 1`,
      )
      .bind(input.organizationId, input.flowToken)
      .first<{ id: string; status: string }>();
    if (existing) {
      // Meta retries. The first set of answers is the one the customer sent.
      if (existing.status === 'answered') return 'duplicate';
      await db
        .prepare(`UPDATE whatsapp_flow_responses
          SET status = 'answered', answers_json = ?, answered_at = CURRENT_TIMESTAMP
          WHERE id = ?`)
        .bind(answers, existing.id)
        .run();
      return 'matched';
    }
  }
  await db
    .prepare(`INSERT INTO whatsapp_flow_responses
      (id, organization_id, flow_id, flow_token, phone, status, answers_json, answered_at)
      VALUES (?, ?, NULL, ?, ?, 'answered_unmatched', ?, CURRENT_TIMESTAMP)`)
    .bind(
      `wfr_${crypto.randomUUID()}`,
      input.organizationId,
      input.flowToken || `unknown_${crypto.randomUUID()}`,
      input.phone,
      answers,
    )
    .run();
  return 'unmatched';
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
          interactive?: {
            type?: string;
            nfm_reply?: { response_json?: string; name?: string };
          };
        }>;
      };
    }>;
  }>;
};
