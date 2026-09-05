'use client';

import { useCallback, useEffect, useState } from 'react';

import { describeRequest } from '@/lib/document-requests';
import {
  ASSOCIATION_KINDS,
  ASSOCIATION_LABEL,
  describeAssociation,
  DOCUMENT_STATUSES,
  nextStatuses,
  type AssociationKind,
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
  association_type: string | null;
  association_id: string | null;
  association_found: boolean;
  association_title: string | null;
};

type DocRequest = {
  id: string;
  document_label: string;
  contact_phone: string | null;
  status: string;
  attempts: number;
  expires_at: string | null;
  document_id: string | null;
  source: string;
  created_at: string;
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
  const [requests, setRequests] = useState<DocRequest[]>([]);
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState({ document: '', phone: '' });
  // Its own field rather than the shared one at the top of the screen: a
  // refusal shown two panels away from the button that caused it reads as an
  // unrelated problem.
  const [askProblem, setAskProblem] = useState<string | null>(null);
  // Shown once, right after minting. Only the hash is stored, so this is the
  // only moment the link can be copied for a customer who is not on WhatsApp.
  const [minted, setMinted] = useState<{ url: string; message: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/app/documents${filter ? `?status=${encodeURIComponent(filter)}` : ''}`,
    );
    if (!response.ok) return;
    const payload = (await response.json()) as {
      documents: Doc[];
      requests?: DocRequest[];
      validationNote: string;
    };
    setDocuments(payload.documents);
    setRequests(payload.requests ?? []);
    setNote(payload.validationNote);
  }, [filter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function post(body: Record<string, unknown>) {
    setProblem(null);
    const response = await fetch('/api/app/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      reason?: string;
    };
    if (!payload.ok) setProblem(payload.reason ?? 'That change was refused.');
    else await load();
  }

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

  async function ask() {
    setAskProblem(null);
    setMinted(null);
    const response = await fetch('/api/app/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'request',
        document: asking.document,
        phone: asking.phone,
      }),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      url?: string;
      message?: string;
      error?: string;
    };
    if (!payload.ok || !payload.url) {
      setAskProblem(payload.error ?? 'The request could not be created.');
      return;
    }
    setMinted({ url: payload.url, message: payload.message ?? '' });
    setAsking({ document: '', phone: '' });
    await load();
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
        <h2 className="text-sm font-semibold">Ask for a document</h2>
        <p className="mt-1 max-w-2xl text-[10px] text-ink-muted">
          Creates a real upload link and returns it once. Nothing is sent from
          here — copy it, or let an agent or a workflow message it. The link
          works for three days and closes as soon as one file arrives.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[10px] text-ink-muted">
            What to ask for
            <input
              value={asking.document}
              onChange={(event) =>
                setAsking((current) => ({
                  ...current,
                  document: event.target.value,
                }))
              }
              placeholder="PAN card"
              className="h-8 w-48 rounded-lg border border-hairline bg-surface px-2.5 text-[11px] text-ink-body"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-ink-muted">
            Their number (optional)
            <input
              value={asking.phone}
              onChange={(event) =>
                setAsking((current) => ({
                  ...current,
                  phone: event.target.value,
                }))
              }
              placeholder="98xxxxxxxx"
              className="h-8 w-40 rounded-lg border border-hairline bg-surface px-2.5 text-[11px] text-ink-body"
            />
          </label>
          <button
            type="button"
            disabled={!asking.document.trim()}
            onClick={() => void ask()}
            className="portal-primary h-8 rounded-lg px-3 text-[11px] disabled:opacity-40"
          >
            Create link
          </button>
        </div>
        {askProblem ? (
          <p role="alert" className="mt-3 text-[10px] text-danger-text">
            {askProblem}
          </p>
        ) : null}
        {minted ? (
          <div className="mt-3 rounded-lg border border-hairline bg-surface-muted p-2.5">
            <p className="text-[10px] text-ink-muted">
              Copy this now — it is not shown again.
            </p>
            <p className="mt-1 break-all text-[11px] text-ink-body">
              {minted.url}
            </p>
            {minted.message ? (
              <p className="mt-2 text-[10px] text-ink-muted">
                Suggested message: {minted.message}
              </p>
            ) : null}
          </div>
        ) : null}
        {requests.length > 0 ? (
          <div className="mt-4 space-y-1.5">
            {requests.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-hairline bg-surface px-3 py-2"
              >
                <span className="text-[11px] text-ink-body">
                  {describeRequest({
                    document: row.document_label,
                    status: row.status,
                    expiresAt: row.expires_at,
                  })}
                  {row.contact_phone ? ` · ${row.contact_phone}` : ''}
                </span>
                {row.status === 'open' ? (
                  <button
                    type="button"
                    onClick={() =>
                      void post({
                        action: 'cancel_request',
                        requestId: row.id,
                      })
                    }
                    className="h-6 rounded-md border border-hairline px-2 text-[10px] text-ink-muted"
                  >
                    Withdraw
                  </button>
                ) : null}
              </div>
            ))}
          </div>
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
              {/* Where it was filed. A link to a row somebody has since deleted
                  reads as handled, so a missing target is said out loud. */}
              <p className="mt-1 text-[10px] text-ink-muted">
                {describeAssociation({
                  kind: document.association_type,
                  id: document.association_id,
                  found: document.association_found,
                  title: document.association_title,
                })}
              </p>
              <FilePicker
                document={document}
                onPick={(kind, targetId) =>
                  post({
                    action: 'associate',
                    documentId: document.id,
                    kind,
                    targetId,
                  })
                }
              />
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

/**
 * Chooses what a document is filed against.
 *
 * Candidates come from the workspace's own rows rather than a free-text id
 * box: a document filed against an id somebody typed is a document filed
 * against nothing, and the screen would look identical either way.
 */
function FilePicker({
  document,
  onPick,
}: {
  document: Doc;
  onPick: (
    kind: string | null,
    targetId: string | null,
  ) => Promise<void> | void;
}) {
  const [kind, setKind] = useState<AssociationKind | ''>('');
  const [targets, setTargets] = useState<Array<{ id: string; title: string }>>(
    [],
  );
  const [loading, setLoading] = useState(false);

  async function chooseKind(next: string) {
    setKind(next as AssociationKind | '');
    setTargets([]);
    if (!next) return;
    setLoading(true);
    try {
      const response = await fetch(
        `/api/app/documents?targets=${encodeURIComponent(next)}`,
      );
      if (!response.ok) return;
      const payload = (await response.json()) as {
        targets: Array<{ id: string; title: string }>;
      };
      setTargets(payload.targets ?? []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <select
        aria-label="What to file this document against"
        value={kind}
        onChange={(event) => void chooseKind(event.target.value)}
        className="h-7 rounded-lg border border-hairline bg-surface px-2 text-[10px]"
      >
        <option value="">File against…</option>
        {ASSOCIATION_KINDS.map((entry) => (
          <option key={entry} value={entry}>
            {ASSOCIATION_LABEL[entry]}
          </option>
        ))}
      </select>
      {kind ? (
        loading ? (
          <span className="text-[9px] text-ink-muted">Loading…</span>
        ) : targets.length === 0 ? (
          <span className="text-[9px] text-ink-muted">
            No {ASSOCIATION_LABEL[kind].toLowerCase()} records in this workspace
            yet.
          </span>
        ) : (
          <select
            aria-label="Which record"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) void onPick(kind, event.target.value);
            }}
            className="h-7 max-w-[220px] rounded-lg border border-hairline bg-surface px-2 text-[10px]"
          >
            <option value="">Choose…</option>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.title}
              </option>
            ))}
          </select>
        )
      ) : null}
      {document.association_id ? (
        <button
          type="button"
          onClick={() => void onPick(null, null)}
          className="rounded-full border border-hairline px-2 py-0.5 text-[9px]"
        >
          Unfile
        </button>
      ) : null}
    </div>
  );
}
