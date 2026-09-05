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
  ASSOCIATION_TABLE,
  checkIncomingMedia,
  canMove,
  isAssociationKind,
  isDocumentStatus,
  type AssociationKind,
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
    .all<Record<string, unknown>>();
  return resolveAssociations(input.organizationId, rows.results ?? []);
}

/**
 * Looks up what each document was filed against.
 *
 * Resolved rather than trusted: an association pointing at a row somebody has
 * since deleted reads as handled on every screen that shows it, which is worse
 * than a document nobody filed. One query per kind, not one per document.
 */
async function resolveAssociations(
  organizationId: string,
  documents: Array<Record<string, unknown>>,
) {
  const db = getRawDb();
  const wanted = new Map<AssociationKind, Set<string>>();
  for (const document of documents) {
    const kind = document.association_type;
    const id = document.association_id;
    if (!isAssociationKind(kind) || typeof id !== 'string' || !id) continue;
    if (!wanted.has(kind)) wanted.set(kind, new Set());
    wanted.get(kind)!.add(id);
  }

  const titles = new Map<string, string>();
  const titleColumn: Record<AssociationKind, string> = {
    lead: 'name',
    order: 'customer_name',
    payment: 'customer_name',
    booking: 'customer_name',
    ticket: 'subject',
  };
  for (const [kind, ids] of wanted) {
    const list = [...ids].slice(0, 100);
    const placeholders = list.map(() => '?').join(', ');
    const rows = await db
      .prepare(`SELECT id, coalesce(${titleColumn[kind]}, '') AS title
        FROM ${ASSOCIATION_TABLE[kind]}
        WHERE organization_id = ? AND id IN (${placeholders})`)
      .bind(organizationId, ...list)
      .all<{ id: string; title: string }>();
    for (const row of rows.results ?? [])
      titles.set(`${kind}:${row.id}`, row.title || row.id);
  }

  return documents.map((document) => {
    const kind = document.association_type;
    const id = document.association_id;
    const key =
      isAssociationKind(kind) && typeof id === 'string'
        ? `${kind}:${id}`
        : null;
    return {
      ...document,
      association_found: key ? titles.has(key) : false,
      association_title: key ? (titles.get(key) ?? null) : null,
    };
  });
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

/**
 * The rows a document could be filed against.
 *
 * Only this workspace's own, and only a handful — this is a picker, not a
 * search engine. Each kind names the column that reads as a title, because
 * "Order order_9c3f…" tells a reviewer nothing.
 */
export async function associationTargets(input: {
  organizationId: string;
  kind: AssociationKind;
  search?: string;
}) {
  const table = ASSOCIATION_TABLE[input.kind];
  // The table comes from a fixed map keyed by a validated kind. Nothing here
  // is ever assembled from a request string.
  const titleColumn: Record<AssociationKind, string> = {
    lead: 'name',
    order: 'customer_name',
    payment: 'customer_name',
    booking: 'customer_name',
    ticket: 'subject',
  };
  const title = titleColumn[input.kind];
  const search = (input.search ?? '').trim().toLowerCase();
  const clauses = ['organization_id = ?'];
  const bindings: unknown[] = [input.organizationId];
  if (search) {
    clauses.push(`lower(coalesce(${title}, '')) LIKE ?`);
    bindings.push(`%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
  }
  const rows = await getRawDb()
    .prepare(`SELECT id, coalesce(${title}, '') AS title, created_at
      FROM ${table} WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC LIMIT 25`)
    .bind(...bindings)
    .all<{ id: string; title: string; created_at: string }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    title: row.title || row.id,
    createdAt: row.created_at,
  }));
}

/**
 * Files a document against something.
 *
 * The target is checked to exist in this workspace before the link is written.
 * A document filed against an id that is not there reads as handled on every
 * screen that shows it, which is worse than one nobody filed.
 */
export async function associateDocument(input: {
  organizationId: string;
  documentId: string;
  kind: string | null;
  targetId: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  const db = getRawDb();

  if (!input.kind || !input.targetId) {
    const cleared = await db
      .prepare(`UPDATE document_inbox SET association_type = NULL, association_id = NULL
        WHERE id = ? AND organization_id = ?`)
      .bind(input.documentId, input.organizationId)
      .run();
    return (cleared.meta?.changes ?? 0) > 0
      ? { ok: true }
      : { ok: false, reason: 'That document is not in this inbox.' };
  }

  if (!isAssociationKind(input.kind))
    return {
      ok: false,
      reason: 'That is not something a document can be filed against.',
    };

  const table = ASSOCIATION_TABLE[input.kind];
  const target = await db
    .prepare(
      `SELECT id FROM ${table} WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(input.targetId, input.organizationId)
    .first<{ id: string }>();
  if (!target)
    return {
      ok: false,
      reason: `That ${input.kind} is not in this workspace, so the document was not filed against it.`,
    };

  const result = await db
    .prepare(`UPDATE document_inbox SET association_type = ?, association_id = ?,
      lead_id = CASE WHEN ? = 'lead' THEN ? ELSE lead_id END
      WHERE id = ? AND organization_id = ?`)
    .bind(
      input.kind,
      input.targetId,
      input.kind,
      input.targetId,
      input.documentId,
      input.organizationId,
    )
    .run();
  return (result.meta?.changes ?? 0) > 0
    ? { ok: true }
    : { ok: false, reason: 'That document is not in this inbox.' };
}
