/**
 * Receiving documents from WhatsApp (Part 3.2, 3.3).
 *
 * WhatsApp is the transport, not the filing cabinet. Provider media is
 * fetchable for a limited window and through an authorised flow only, so the
 * business copy is pulled promptly into storage this workspace controls, and
 * the row records what was kept rather than pointing at somebody else's URL
 * that will stop resolving.
 *
 * The order of operations is the whole design: check what the provider *says*
 * about the file first, fetch only if that passes, then check the bytes before
 * anything is written. Refusing a 200MB file after downloading it is not a
 * limit, and storing an executable to inspect it later is not a check.
 */

import { env } from 'cloudflare:workers';

import { getRawDb } from '@/db/index';
import { documentKey, keyBelongsTo } from '@/lib/recording-keys';
import {
  checkIncomingMedia,
  canMove,
  isDocumentStatus,
  type DocumentStatus,
} from '@/lib/whatsapp-media';

/** How much of a file is enough to identify it. */
const SNIFF_BYTES = 32;

export type IntakeResult =
  | { ok: true; documentId: string; storageKey: string; kind: string }
  | { ok: false; documentId: string | null; reason: string; detail: string };

/**
 * Takes one media item from a WhatsApp webhook into the Document Inbox.
 *
 * A refusal is still recorded. A workspace whose customer sent an unsupported
 * file needs to see that something arrived and was turned away — silence would
 * look identical to the customer never sending it, and somebody would sit
 * waiting for a document that had already been rejected.
 */
export async function intakeWhatsAppDocument(input: {
  organizationId: string;
  mediaId: string;
  mimeType: string;
  sizeBytes: number;
  filename?: string | null;
  fromPhone: string;
  accessToken: string;
  graphVersion: string;
}): Promise<IntakeResult> {
  const db = getRawDb();
  const documentId = `doc_${crypto.randomUUID()}`;

  const record = async (
    status: DocumentStatus,
    extra: {
      storageKey?: string | null;
      checksum?: string | null;
      rejection?: string | null;
      leadId?: string | null;
    },
  ) => {
    await db
      .prepare(`INSERT OR IGNORE INTO document_inbox
        (id, organization_id, contact_phone, lead_id, source, provider_media_id,
         filename, mime_type, size_bytes, checksum, storage_key, status, rejection_reason)
        VALUES (?, ?, ?, ?, 'whatsapp', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        documentId,
        input.organizationId,
        input.fromPhone,
        extra.leadId ?? null,
        input.mediaId,
        (input.filename ?? '').slice(0, 200) || null,
        input.mimeType,
        Math.max(0, Math.round(input.sizeBytes)),
        extra.checksum ?? null,
        extra.storageKey ?? null,
        status,
        extra.rejection ?? null,
      )
      .run();
  };

  // 1. What the provider claims, before anything is fetched.
  const declared = checkIncomingMedia({
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  });
  if (!declared.ok) {
    await record('rejected', { rejection: declared.detail });
    return {
      ok: false,
      documentId,
      reason: declared.reason,
      detail: declared.detail,
    };
  }

  // 2. The authorised two-step fetch: the id resolves to a short-lived URL,
  //    which is then read with the same token. A media URL is not public.
  let url: string;
  try {
    const lookup = await fetch(
      `https://graph.facebook.com/${input.graphVersion}/${encodeURIComponent(input.mediaId)}`,
      { headers: { authorization: `Bearer ${input.accessToken}` } },
    );
    if (!lookup.ok) throw new Error(String(lookup.status));
    const payload = (await lookup.json()) as { url?: string };
    if (!payload.url) throw new Error('no url');
    url = payload.url;
  } catch {
    const detail =
      'WhatsApp would not hand over this file. Provider media expires, so ask the customer to send it again.';
    await record('needs_new_file', { rejection: detail });
    return { ok: false, documentId, reason: 'media_unavailable', detail };
  }

  let bytes: Uint8Array;
  let buffer: ArrayBuffer;
  try {
    const download = await fetch(url, {
      headers: { authorization: `Bearer ${input.accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!download.ok) throw new Error(String(download.status));
    buffer = await download.arrayBuffer();
    bytes = new Uint8Array(buffer);
  } catch {
    const detail =
      'The file could not be downloaded from WhatsApp before it expired.';
    await record('needs_new_file', { rejection: detail });
    return { ok: false, documentId, reason: 'download_failed', detail };
  }

  // 3. The bytes, now that we have them. A provider's mime type is a claim by
  //    whoever sent the file; this is the only check that tests it.
  const verified = checkIncomingMedia({
    mimeType: input.mimeType,
    sizeBytes: bytes.length,
    bytes: bytes.slice(0, SNIFF_BYTES),
  });
  if (!verified.ok) {
    await record('rejected', { rejection: verified.detail });
    return {
      ok: false,
      documentId,
      reason: verified.reason,
      detail: verified.detail,
    };
  }

  const storageKey = documentKey({
    organizationId: input.organizationId,
    documentId,
    extension: verified.extension,
  });
  if (!env.RECORDINGS) {
    const detail = 'No document storage is configured on this deployment.';
    await record('rejected', { rejection: detail });
    return { ok: false, documentId, reason: 'no_storage', detail };
  }
  await env.RECORDINGS.put(storageKey, bytes, {
    httpMetadata: { contentType: verified.mime },
    customMetadata: {
      organizationId: input.organizationId,
      documentId,
      source: 'whatsapp',
    },
  });

  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const checksum = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  // Attach it to the lead this number already belongs to, where there is one.
  const lead = await db
    .prepare(`SELECT id FROM leads WHERE organization_id = ?
      AND replace(replace(replace(phone, ' ', ''), '-', ''), '+', '') LIKE ? LIMIT 1`)
    .bind(
      input.organizationId,
      `%${input.fromPhone.replace(/\D/g, '').slice(-10)}`,
    )
    .first<{ id: string }>();

  await record('new', { storageKey, checksum, leadId: lead?.id ?? null });
  return { ok: true, documentId, storageKey, kind: verified.kind };
}

export async function listDocuments(input: {
  organizationId: string;
  status?: string;
  limit?: number;
}) {
  const clauses = ['d.organization_id = ?'];
  const bindings: unknown[] = [input.organizationId];
  if (input.status && isDocumentStatus(input.status)) {
    clauses.push('d.status = ?');
    bindings.push(input.status);
  }
  const rows = await getRawDb()
    .prepare(`SELECT d.id, d.contact_phone, d.lead_id, d.source, d.document_type,
        d.filename, d.mime_type, d.size_bytes, d.checksum, d.status, d.rejection_reason,
        d.association_type, d.association_id, d.reviewed_at, d.created_at,
        d.storage_key IS NOT NULL AND d.storage_key != '' AS has_file,
        l.name AS lead_name
      FROM document_inbox d LEFT JOIN leads l ON l.id = d.lead_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY d.created_at DESC LIMIT ?`)
    .bind(...bindings, Math.min(200, Math.max(1, input.limit ?? 100)))
    .all();
  return rows.results ?? [];
}

export async function reviewDocument(input: {
  organizationId: string;
  documentId: string;
  status: DocumentStatus;
  documentType?: string;
  userId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const db = getRawDb();
  const row = await db
    .prepare(
      `SELECT status FROM document_inbox WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(input.documentId, input.organizationId)
    .first<{ status: string }>();
  if (!row) return { ok: false, reason: 'That document is not in this inbox.' };
  if (!isDocumentStatus(row.status))
    return {
      ok: false,
      reason: 'That document is in a state this build does not know.',
    };
  // The transition rules live in the pure module, so "accepted is terminal"
  // is enforced here and not only drawn on the screen.
  if (!canMove(row.status, input.status))
    return {
      ok: false,
      reason: `A document that is ${row.status.replace('_', ' ')} cannot be moved to ${input.status.replace('_', ' ')}.`,
    };
  await db
    .prepare(`UPDATE document_inbox SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
      document_type = coalesce(?, document_type) WHERE id = ? AND organization_id = ?`)
    .bind(
      input.status,
      input.userId,
      input.documentType?.slice(0, 60) || null,
      input.documentId,
      input.organizationId,
    )
    .run();
  return { ok: true };
}

/** Streams one stored document, for this workspace only. */
export async function readDocument(organizationId: string, documentId: string) {
  const row = await getRawDb()
    .prepare(
      `SELECT storage_key, mime_type, filename FROM document_inbox WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(documentId, organizationId)
    .first<{
      storage_key: string | null;
      mime_type: string;
      filename: string | null;
    }>();
  if (!row?.storage_key) return null;
  // Same rule as recordings: a key outside this tenant's prefix is not served,
  // whatever the row says.
  if (!keyBelongsTo(row.storage_key, organizationId)) return null;
  if (!env.RECORDINGS) return null;
  const object = await env.RECORDINGS.get(row.storage_key);
  if (!object) return null;
  return { object, mimeType: row.mime_type, filename: row.filename };
}
