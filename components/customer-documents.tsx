'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  DOCUMENT_STATUSES,
  nextStatuses,
  type DocumentStatus,
} from '@/lib/whatsapp-media';

/**
 * The Document Inbox (Part 3.3).
 *
 * Files customers sent in — an Aadhaar card, a receipt, a signed form —
 * pulled out of WhatsApp into storage this workspace controls, because
 * provider media stops resolving and a business copy cannot depend on it.
 *
 * Two things this screen is careful about.
 *
 * It says what was checked. "Not scanned for viruses" sits above the list
 * rather than being left to assumption, because somebody is about to open a
 * stranger's PDF and deserves to know exactly what the platform did and did
 * not do to it.
 *
 * It shows refusals. A file that arrived and was turned away is listed with
 * the reason — a workspace that sees nothing cannot tell "the customer never
 * sent it" from "we rejected it", and somebody will sit waiting for a document
 * that was refused an hour ago.
 */

type Doc = {
  id: string;
  contact_phone: string | null;
  lead_id: string | null;
  lead_name: string | null;
  source: string;
  document_type: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number;
  checksum: string | null;
  status: DocumentStatus;
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  has_file: number;
};

const STATUS_TONE: Record<string, string> = {
  new: 'text-primary',
  under_review: 'text-warning-text',
  accepted: 'text-success-text',
  rejected: 'text-danger-text',
  needs_new_file: 'text-warning-text',
};

export function CustomerDocuments() {
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/app/documents${filter ? `?status=${encodeURIComponent(filter)}` : ''}`,
    );
    if (!response.ok) return;
    const payload = (await response.json()) as {
      documents: Doc[];
      validationNote: string;
    };
    setDocuments(payload.documents);
    setNote(payload.validationNote);
  }, [filter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function review(documentId: string, status: DocumentStatus) {
    setProblem(null);
    const response = await fetch('/api/app/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentId, status }),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      reason?: string;
    };
    if (!payload.ok) setProblem(payload.reason ?? 'That change was refused.');
    else await load();
  }

  return (
    <div className="space-y-6">
      <section className="portal-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Document inbox</h2>
            <p className="mt-1 max-w-2xl text-[10px] text-ink-muted">
              Files your customers send over WhatsApp, kept in your own storage
              rather than left on the provider — WhatsApp media stops resolving
              after a while, and a business record cannot depend on it.
            </p>
          </div>
          <select
            aria-label="Filter by status"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="h-8 rounded-lg border border-hairline bg-surface px-2.5 text-[10px]"
          >
            <option value="">All</option>
            {DOCUMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        {note ? (
          /* Said out loud, because the next click opens a stranger's file. */
          <p className="mt-3 rounded-lg border border-hairline bg-surface-muted p-2.5 text-[10px] text-ink-body">
            {note}
          </p>
        ) : null}
        {problem ? (
          <p role="alert" className="mt-2 text-[10px] text-danger-text">
            {problem}
          </p>
        ) : null}
      </section>

      <section className="portal-panel p-5">
        {documents.length === 0 ? (
          <p className="text-[11px] text-ink-muted">
            {filter
              ? 'Nothing in this state.'
              : 'Nothing yet. Documents appear here the moment a customer sends one to your WhatsApp number.'}
          </p>
        ) : null}
        <div className="space-y-2">
          {documents.map((document) => (
            <div
              key={document.id}
              className="rounded-lg border border-hairline bg-surface px-3 py-2.5"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[11px] font-medium">
                  {document.filename || document.document_type}
                </span>
                <span className="text-[9px] text-ink-muted">
                  {document.lead_name
                    ? document.lead_name
                    : (document.contact_phone ?? 'unknown number')}
                </span>
                <span
                  className={`ml-auto text-[9px] ${STATUS_TONE[document.status] ?? 'text-ink-muted'}`}
                >
                  {document.status.replaceAll('_', ' ')}
                </span>
              </div>
              <p className="mt-0.5 text-[9px] text-ink-muted">
                {document.mime_type ?? 'unknown type'} ·{' '}
                {Math.max(1, Math.round(document.size_bytes / 1024))} KB ·{' '}
                {document.source} · {document.created_at}
              </p>
              {document.rejection_reason ? (
                /* Why it was turned away, so nobody waits for a file that was
                   refused an hour ago. */
                <p className="mt-1 text-[10px] text-warning-text">
                  {document.rejection_reason}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {document.has_file ? (
                  <a
                    href={`/api/app/documents/${encodeURIComponent(document.id)}`}
                    className="rounded-full border border-hairline px-2.5 py-1 text-[10px]"
                  >
                    Download
                  </a>
                ) : (
                  <span className="text-[9px] text-ink-muted">
                    No file was stored.
                  </span>
                )}
                {nextStatuses(document.status).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => void review(document.id, status)}
                    className="rounded-full border border-hairline px-2.5 py-1 text-[10px]"
                  >
                    {status === 'under_review'
                      ? 'Start review'
                      : status === 'needs_new_file'
                        ? 'Ask for a new file'
                        : status.replaceAll('_', ' ')}
                  </button>
                ))}
                {nextStatuses(document.status).length === 0 ? (
                  <span className="text-[9px] text-ink-muted">
                    Accepted — this one is settled.
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
