/**
 * Document requests against the database and storage.
 *
 * The rules are in `lib/document-requests.ts`; this is the part that touches
 * D1 and R2. Two things it is careful about:
 *
 * - A request that cannot produce a link is not created at all. A row saying
 *   "waiting for the customer" when the customer was never given anywhere to
 *   go is exactly the kind of record this codebase keeps finding and removing.
 * - The uploaded bytes go through the same `checkIncomingMedia` as WhatsApp
 *   media, in the same order — declared type and size first, magic bytes after.
 *   An upload endpoint is a more exposed way in than a provider webhook, not a
 *   less exposed one, so it does not get a laxer check.
 */

import { env } from 'cloudflare:workers';

import { getRawDb } from '@/db/index';
import {
  MAX_ATTEMPTS,
  expiryFrom,
  linkProblem,
  normaliseDocumentLabel,
  requestMessage,
  requestState,
  uploadUrl,
  type RequestState,
} from '@/lib/document-requests';
import { documentKey } from '@/lib/recording-keys';
import { createOpaqueToken, sha256 } from '@/lib/security';
import {
  VALIDATION_NOTE,
  checkIncomingMedia,
  isAssociationKind,
  type AssociationKind,
} from '@/lib/whatsapp-media';

const SNIFF_BYTES = 32;

export type CreatedRequest = {
  ok: true;
  id: string;
  token: string;
  url: string;
  message: string;
  expiresAt: string;
};

export type CreateFailure = { ok: false; reason: string; detail: string };

/**
 * Mints one request and the message that carries it.
 *
 * The message is returned rather than sent, because who sends it differs — a
 * workflow step, a live agent's tool call, a person on a screen — and every
 * one of them already has its own way of refusing when there is no WhatsApp
 * connection. What they must not do is invent their own wording for the link.
 */
export async function createDocumentRequest(input: {
  organizationId: string;
  document: string;
  contactPhone?: string | null;
  leadId?: string | null;
  associationType?: string | null;
  associationId?: string | null;
  requestedBy?: string | null;
  source?: string;
  ttlHours?: number;
  businessName?: string | null;
}): Promise<CreatedRequest | CreateFailure> {
  const document = normaliseDocumentLabel(input.document);
  if (!document)
    return {
      ok: false,
      reason: 'no_document',
      detail: 'Nothing was named, so there is nothing to ask the customer for.',
    };

  const base = process.env.PUBLIC_BASE_URL;
  const problem = linkProblem(base);
  if (problem) return { ok: false, reason: 'no_public_url', detail: problem };

  const token = createOpaqueToken();
  const url = uploadUrl(base, token);
  // `linkProblem` already passed, so this is unreachable in practice; it is
  // here so the type is a string and not a maybe-string by assertion.
  if (!url)
    return {
      ok: false,
      reason: 'no_public_url',
      detail: 'No upload link could be built for this deployment.',
    };

  const id = `dreq_${crypto.randomUUID()}`;
  const expiresAt = expiryFrom(new Date(), input.ttlHours);
  const association = isAssociationKind(input.associationType)
    ? (input.associationType as AssociationKind)
    : null;

  await getRawDb()
    .prepare(`INSERT INTO document_requests
      (id, organization_id, token_hash, document_label, contact_phone, lead_id,
       association_type, association_id, status, expires_at, requested_by, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`)
    .bind(
      id,
      input.organizationId,
      await sha256(token),
      document,
      input.contactPhone ?? null,
      input.leadId ?? null,
      association,
      association ? (input.associationId ?? null) : null,
      expiresAt,
      input.requestedBy ?? null,
      input.source ?? 'manual',
    )
    .run();

  return {
    ok: true,
    id,
    token,
    url,
    expiresAt,
    message: requestMessage({
      document,
      url,
      business: input.businessName ?? null,
      expiresAt,
    }),
  };
}

export type ResolvedRequest = {
  id: string;
  organizationId: string;
  document: string;
  state: RequestState;
};

/**
 * What a token points at, for the page the customer opens.
 *
 * Deliberately thin: the customer is shown the document being asked for and
 * whether the link still works. Nothing about the workspace, the lead, or the
 * case leaves through this — whoever is holding the URL is only known to be
 * holding the URL.
 */
export async function resolveUploadToken(
  token: string,
): Promise<ResolvedRequest | null> {
  const row = await getRawDb()
    .prepare(
      `SELECT id, organization_id, document_label, status, expires_at, attempts
       FROM document_requests WHERE token_hash = ? LIMIT 1`,
    )
    .bind(await sha256(String(token ?? '')))
    .first<{
      id: string;
      organization_id: string;
      document_label: string;
      status: string;
      expires_at: string | null;
      attempts: number;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    document: row.document_label,
    state: requestState(row),
  };
}

export type UploadResult =
  | { ok: true; documentId: string; document: string; note: string }
  | { ok: false; status: number; reason: string; detail: string };

/**
 * Takes the customer's file.
 *
 * A refused upload still counts against the request. That is what stops the
 * endpoint being a free file scanner for whoever has the URL, and it is why
 * the counter is incremented before any of the expensive work.
 */
export async function acceptUpload(input: {
  token: string;
  filename?: string | null;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<UploadResult> {
  const db = getRawDb();
  const tokenHash = await sha256(String(input.token ?? ''));
  const row = await db
    .prepare(
      `SELECT id, organization_id, document_label, status, expires_at, attempts,
              contact_phone, lead_id, association_type, association_id
       FROM document_requests WHERE token_hash = ? LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{
      id: string;
      organization_id: string;
      document_label: string;
      status: string;
      expires_at: string | null;
      attempts: number;
      contact_phone: string | null;
      lead_id: string | null;
      association_type: string | null;
      association_id: string | null;
    }>();

  if (!row)
    return {
      ok: false,
      status: 404,
      reason: 'unknown_link',
      detail: 'This upload link is not valid. Ask for a new one.',
    };

  const state = requestState(row);
  if (!state.open)
    return {
      ok: false,
      status: state.reason === 'fulfilled' ? 409 : 410,
      reason: state.reason,
      detail: state.message,
    };

  const fail = async (
    status: number,
    reason: string,
    detail: string,
  ): Promise<UploadResult> => {
    const attempts = row.attempts + 1;
    await db
      .prepare(
        `UPDATE document_requests SET attempts = ?, status = ? WHERE id = ? AND status = 'open'`,
      )
      .bind(attempts, attempts >= MAX_ATTEMPTS ? 'cancelled' : 'open', row.id)
      .run();
    return { ok: false, status, reason, detail };
  };

  const verified = checkIncomingMedia({
    mimeType: input.mimeType,
    sizeBytes: input.bytes.length,
    bytes: input.bytes.slice(0, SNIFF_BYTES),
  });
  if (!verified.ok) return fail(415, verified.reason, verified.detail);

  const documentId = `doc_${crypto.randomUUID()}`;
  const storageKey = documentKey({
    organizationId: row.organization_id,
    documentId,
    extension: verified.extension,
  });
  if (!env.RECORDINGS)
    return fail(
      503,
      'no_storage',
      'This deployment has nowhere to keep the file, so it was not accepted. Nothing was uploaded — please try later.',
    );

  await env.RECORDINGS.put(storageKey, input.bytes, {
    httpMetadata: { contentType: verified.mime },
    customMetadata: {
      organizationId: row.organization_id,
      documentId,
      source: 'upload',
    },
  });

  const digest = await crypto.subtle.digest(
    'SHA-256',
    input.bytes.slice().buffer as ArrayBuffer,
  );
  const checksum = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  await db
    .prepare(`INSERT INTO document_inbox
      (id, organization_id, contact_phone, lead_id, source, document_type,
       filename, mime_type, size_bytes, checksum, storage_key, status,
       association_type, association_id)
      VALUES (?, ?, ?, ?, 'upload', ?, ?, ?, ?, ?, ?, 'new', ?, ?)`)
    .bind(
      documentId,
      row.organization_id,
      row.contact_phone,
      row.lead_id,
      row.document_label,
      (input.filename ?? '').slice(0, 200) || null,
      verified.mime,
      input.bytes.length,
      checksum,
      storageKey,
      row.association_type,
      row.association_id,
    )
    .run();

  // One request, one file. Guarded on `status = 'open'` so two uploads racing
  // each other cannot both be recorded as the one that fulfilled it.
  const claimed = await db
    .prepare(
      `UPDATE document_requests
       SET status = 'fulfilled', document_id = ?, fulfilled_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'open'`,
    )
    .bind(documentId, row.id)
    .run();
  if (!claimed.meta?.changes) {
    // Someone else got there first. The file is already stored and filed, so
    // it stays in the inbox for a person to look at rather than being deleted
    // out from under them — but this uploader is told the truth.
    return {
      ok: false,
      status: 409,
      reason: 'already_fulfilled',
      detail:
        'A file for this request had already arrived, so this one was not needed.',
    };
  }

  return {
    ok: true,
    documentId,
    document: row.document_label,
    note: VALIDATION_NOTE,
  };
}

/** Withdraws a request, so a customer is not chased for something no longer wanted. */
export async function cancelDocumentRequest(input: {
  organizationId: string;
  requestId: string;
}) {
  const result = await getRawDb()
    .prepare(
      `UPDATE document_requests SET status = 'cancelled'
       WHERE id = ? AND organization_id = ? AND status = 'open'`,
    )
    .bind(input.requestId, input.organizationId)
    .run();
  return { cancelled: Boolean(result.meta?.changes) };
}

/** The workspace's own view: what has been asked for and what came back. */
export async function listDocumentRequests(input: {
  organizationId: string;
  limit?: number;
}) {
  const limit = Math.min(200, Math.max(1, Math.round(input.limit ?? 50)));
  const { results } = await getRawDb()
    .prepare(
      `SELECT id, document_label, contact_phone, status, attempts, expires_at,
              document_id, fulfilled_at, source, created_at
       FROM document_requests WHERE organization_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(input.organizationId, limit)
    .all<{
      id: string;
      document_label: string;
      contact_phone: string | null;
      status: string;
      attempts: number;
      expires_at: string | null;
      document_id: string | null;
      fulfilled_at: string | null;
      source: string;
      created_at: string;
    }>();
  return (results ?? []).map((row) => ({
    ...row,
    state: requestState(row),
  }));
}
