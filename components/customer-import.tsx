'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Bulk calling import (§10-11).
 *
 * Upload, see exactly which rows were accepted and why each other row was not,
 * then commit into a campaign. Nothing is added until the customer has looked
 * at the rejections — importing blind is how a list ends up dialling the wrong
 * people.
 */

type Totals = {
  rows: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  suppressed: number;
  truncated: boolean;
};
type SampleRow = {
  rowNumber: number;
  phone: string | null;
  name: string;
  status: string;
  reason: string | null;
};
type Preview = {
  jobId: string;
  format: string;
  headers: string[];
  mapping: Record<string, number>;
  totals: Totals;
  sample: SampleRow[];
};
type JobRow = Record<string, unknown>;

const FIELD_LABELS: Array<{ key: string; label: string; required: boolean }> = [
  { key: 'phone', label: 'Phone number', required: true },
  { key: 'name', label: 'Name', required: false },
  { key: 'language', label: 'Language', required: false },
  { key: 'timezone', label: 'Timezone', required: false },
  { key: 'company', label: 'Company', required: false },
  { key: 'notes', label: 'Notes', required: false },
];

function str(value: unknown, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return value.toString();
  return fallback;
}

const tone = (status: string) =>
  status === 'accepted'
    ? 'text-emerald-200'
    : status === 'duplicate'
      ? 'text-amber-200'
      : status === 'suppressed'
        ? 'text-sky-200'
        : 'text-rose-200';

export function CustomerImport({
  campaigns,
  onChanged,
}: {
  campaigns: Array<{ id: string; name: string }>;
  onChanged: () => Promise<void> | void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [rejected, setRejected] = useState<JobRow[]>([]);
  const [countryCode, setCountryCode] = useState('91');
  const [campaignId, setCampaignId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/app/imports');
      if (!response.ok) return;
      const body = (await response.json()) as { jobs?: JobRow[] };
      setJobs(body.jobs ?? []);
    } catch {
      /* the list is a convenience; failing to load it is not fatal */
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadJobs(), 0);
    return () => window.clearTimeout(timer);
  }, [loadJobs]);

  async function upload(file: File, mapping?: Record<string, number>) {
    setBusy(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('countryCode', countryCode);
      if (mapping) form.append('mapping', JSON.stringify(mapping));
      const response = await fetch('/api/app/imports', {
        method: 'POST',
        body: form,
      });
      const body = (await response.json()) as Preview & { error?: string };
      if (!response.ok) {
        setNotice(body.error ?? 'The file could not be imported.');
        return;
      }
      setPreview(body);
      await loadJobs();
      if (body.totals.rejected || body.totals.suppressed)
        await loadRejected(body.jobId);
      else setRejected([]);
    } finally {
      setBusy(false);
    }
  }

  async function loadRejected(jobId: string) {
    try {
      const response = await fetch(
        `/api/app/imports?job=${encodeURIComponent(jobId)}&rows=all`,
      );
      if (!response.ok) return;
      const body = (await response.json()) as { rows?: JobRow[] };
      setRejected(
        (body.rows ?? []).filter((row) => str(row.status) !== 'accepted'),
      );
    } catch {
      setRejected([]);
    }
  }

  async function commit() {
    if (!preview || !campaignId) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/app/imports', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: preview.jobId, campaignId }),
      });
      const body = (await response.json()) as {
        error?: string;
        added?: number;
        note?: string;
        audienceSize?: number;
      };
      if (!response.ok) {
        setNotice(body.error ?? 'The import could not be committed.');
        return;
      }
      setNotice(
        `Added ${body.added} contact(s); the campaign audience is now ${body.audienceSize}.` +
          (body.note ? ` ${body.note}` : ''),
      );
      setPreview(null);
      setRejected([]);
      if (fileRef.current) fileRef.current.value = '';
      await loadJobs();
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  const remap = (field: string, columnIndex: string) => {
    if (!preview) return;
    const mapping = { ...preview.mapping };
    if (columnIndex === '') delete mapping[field];
    else mapping[field] = Number(columnIndex);
    const file = fileRef.current?.files?.[0];
    if (file) void upload(file, mapping);
  };

  return (
    <section className="portal-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileSpreadsheet className="size-4 text-[#afbcff]" />
            Import an audience
          </h2>
          <p className="mt-1 text-[10px] leading-relaxed text-white/32">
            CSV, TSV or XLSX. Rows are validated, de-duplicated and checked
            against your suppression list before anything is added.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[10px] text-white/45">
          Default country code
          <input
            value={countryCode}
            onChange={(event) =>
              setCountryCode(event.target.value.replace(/\D/g, '').slice(0, 4))
            }
            className="w-16 rounded-lg border border-white/10 bg-white/4 px-2 py-1.5 text-[11px] text-white outline-none focus:border-white/25"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xlsm"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
          className="text-[11px] text-white/55 file:mr-3 file:rounded-lg file:border file:border-white/12 file:bg-white/6 file:px-3 file:py-1.5 file:text-[11px] file:text-white/80"
        />
        {busy ? (
          <span className="flex items-center gap-1.5 text-[10px] text-white/45">
            <Loader2 className="size-3 animate-spin" /> Reading…
          </span>
        ) : null}
      </div>

      {notice ? (
        <p className="mt-3 rounded-lg border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] text-white/70">
          {notice}
        </p>
      ) : null}

      {preview ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-2 sm:grid-cols-5">
            {[
              ['Rows', preview.totals.rows, 'text-white'],
              ['Accepted', preview.totals.accepted, 'text-emerald-200'],
              ['Rejected', preview.totals.rejected, 'text-rose-200'],
              ['Duplicates', preview.totals.duplicates, 'text-amber-200'],
              ['Suppressed', preview.totals.suppressed, 'text-sky-200'],
            ].map(([label, value, colour]) => (
              <div
                key={String(label)}
                className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5"
              >
                <p className="text-[9px] uppercase tracking-wider text-white/28">
                  {String(label)}
                </p>
                <p className={`mt-1 text-base font-semibold ${String(colour)}`}>
                  {String(value)}
                </p>
              </div>
            ))}
          </div>
          {preview.totals.truncated ? (
            <p className="rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2 text-[11px] text-amber-100">
              The file was longer than the row limit, so only the first rows were
              read. Split it and import the rest separately.
            </p>
          ) : null}

          <div>
            <p className="text-[10px] uppercase tracking-wider text-white/28">
              Column mapping · {preview.format.toUpperCase()}
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {FIELD_LABELS.map((field) => (
                <label key={field.key} className="block">
                  <span className="text-[10px] text-white/45">
                    {field.label}
                    {field.required ? ' *' : ''}
                  </span>
                  <select
                    value={preview.mapping[field.key] ?? ''}
                    onChange={(event) => remap(field.key, event.target.value)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/4 px-2 py-1.5 text-[11px]"
                  >
                    <option value="">— not mapped —</option>
                    {preview.headers.map((header, index) => (
                      <option key={`${header}-${index}`} value={index}>
                        {header || `Column ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-white/28">
              First rows
            </p>
            <div className="mt-2 space-y-1">
              {preview.sample.map((row) => (
                <div
                  key={row.rowNumber}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-[11px]"
                >
                  <span className="w-8 font-mono text-[9px] text-white/28">
                    {row.rowNumber}
                  </span>
                  <span className="font-mono text-[10px]">
                    {row.phone ?? '—'}
                  </span>
                  <span className="text-white/55">{row.name || '—'}</span>
                  <span className={`ml-auto text-[9px] ${tone(row.status)}`}>
                    {row.status}
                    {row.reason ? ` · ${row.reason}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {rejected.length ? (
            <details className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
              <summary className="cursor-pointer text-[11px] text-white/70">
                {rejected.length} row(s) will not be called — see why
              </summary>
              <div className="mt-2 space-y-1">
                {rejected.slice(0, 50).map((row) => (
                  <div
                    key={str(row.row_number)}
                    className="flex flex-wrap items-center gap-2 text-[10px]"
                  >
                    <span className="w-8 font-mono text-white/28">
                      {str(row.row_number)}
                    </span>
                    <span className="font-mono">{str(row.phone, '—')}</span>
                    <span className="text-white/45">{str(row.name, '—')}</span>
                    <span className={`ml-auto ${tone(str(row.status))}`}>
                      {str(row.status)} · {str(row.reason, 'no reason')}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
              className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-[11px]"
            >
              <option value="">Add to campaign…</option>
              {campaigns.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <Button
              className="portal-primary"
              disabled={busy || !campaignId || !preview.totals.accepted}
              onClick={() => void commit()}
            >
              <Upload />
              Add {preview.totals.accepted} contact(s)
            </Button>
            {!preview.totals.accepted ? (
              <span className="text-[10px] text-white/35">
                Nothing to add — fix the file and upload again.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {jobs.length ? (
        <div className="mt-6">
          <p className="text-[10px] uppercase tracking-wider text-white/28">
            Recent imports
          </p>
          <div className="mt-2 space-y-1">
            {jobs.slice(0, 6).map((job) => (
              <div
                key={str(job.id)}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-[10px]"
              >
                <span className="text-white/70">{str(job.filename)}</span>
                <span className="text-white/28">
                  {str(job.format).toUpperCase()}
                </span>
                <span className="text-emerald-200">
                  {str(job.accepted_rows)} accepted
                </span>
                {Number(job.rejected_rows ?? 0) ? (
                  <span className="text-rose-200">
                    {str(job.rejected_rows)} rejected
                  </span>
                ) : null}
                <span className="ml-auto text-white/28">
                  {str(job.status)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
