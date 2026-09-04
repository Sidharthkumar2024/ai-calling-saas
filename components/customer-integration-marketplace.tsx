'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plug, Search, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type {
  CredentialField,
  IntegrationDefinition,
} from '@/lib/integration-catalog';

/**
 * Integration marketplace (blueprint §13).
 *
 * Replaces a single form with a type dropdown: the customer can now see every
 * connectable provider by category, what each one needs, and — importantly —
 * whether a credential can actually be verified here or only stored.
 */

type Connection = {
  id: string;
  type: string;
  name: string;
  status: string;
  last_checked_at?: string | null;
  public_config_json?: string;
};
type CatalogEntry = IntegrationDefinition & { connection: Connection | null };

const STATUS_LABEL: Record<string, string> = {
  connected: 'Connected',
  test_pending: 'Needs testing',
  test_failed: 'Test failed',
  stored_unverified: 'Stored · unverified',
  needs_documentation: 'Needs provider docs',
};

function statusTone(status: string) {
  if (status === 'connected')
    return 'border-emerald-400/35 bg-emerald-400/10 text-emerald-100';
  if (status === 'test_failed')
    return 'border-rose-400/35 bg-rose-400/10 text-rose-100';
  if (status === 'stored_unverified')
    return 'border-amber-400/30 bg-amber-400/10 text-amber-100';
  return 'border-white/12 bg-white/5 text-white/60';
}

export function CustomerIntegrationMarketplace() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [unrecognised, setUnrecognised] = useState<Connection[]>([]);
  const [categories, setCategories] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [openType, setOpenType] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  async function load() {
    try {
      const response = await fetch('/api/app/integrations');
      const body = (await response.json()) as {
        catalog?: CatalogEntry[];
        categories?: Array<{ id: string; label: string }>;
        unrecognised?: Connection[];
        error?: string;
      };
      if (!response.ok) {
        setError(body.error ?? 'Could not load integrations.');
        return;
      }
      setCatalog(body.catalog ?? []);
      setCategories(body.categories ?? []);
      setUnrecognised(body.unrecognised ?? []);
      setError(null);
    } catch {
      setError('Could not load integrations.');
    } finally {
      setReady(true);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return catalog.filter((entry) => {
      if (category && entry.category !== category) return false;
      if (!needle) return true;
      return (
        entry.label.toLowerCase().includes(needle) ||
        entry.blurb.toLowerCase().includes(needle) ||
        entry.category.includes(needle)
      );
    });
  }, [catalog, category, query]);

  const connectedCount = catalog.filter(
    (entry) => entry.connection?.status === 'connected',
  ).length;
  const storedCount = catalog.filter((entry) => entry.connection).length;

  function openForm(entry: CatalogEntry) {
    setOpenType(entry.id);
    setNotice(null);
    const initial: Record<string, string> = { name: entry.label };
    if (entry.connection) {
      try {
        const config = JSON.parse(
          entry.connection.public_config_json || '{}',
        ) as Record<string, unknown>;
        for (const field of entry.fields) {
          const value = config[field.key];
          // Secrets are never returned by the API, so only public config
          // prefills — the key must be re-entered to change it.
          if (!field.secret && typeof value === 'string') {
            initial[field.key] = value;
          }
        }
      } catch {
        /* keep defaults */
      }
    }
    setForm(initial);
  }

  async function save(entry: CatalogEntry) {
    setBusy(`save-${entry.id}`);
    setNotice(null);
    try {
      const response = await fetch('/api/app/integrations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: entry.id, ...form }),
      });
      const body = (await response.json()) as {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        setNotice(body.error ?? 'Could not save the connection.');
        return;
      }
      setNotice(body.message ?? 'Saved.');
      setOpenType(null);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function test(entry: CatalogEntry) {
    if (!entry.connection) return;
    setBusy(`test-${entry.id}`);
    setNotice(null);
    try {
      const response = await fetch('/api/app/integrations', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'test', id: entry.connection.id }),
      });
      const body = (await response.json()) as {
        error?: string;
        message?: string;
        status?: string;
      };
      setNotice(
        body.error ??
          body.message ??
          `${entry.label} responded — marked ${body.status ?? 'connected'}.`,
      );
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(entry: CatalogEntry) {
    if (!entry.connection) return;
    setBusy(`drop-${entry.id}`);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/app/integrations?id=${encodeURIComponent(entry.connection.id)}`,
        { method: 'DELETE' },
      );
      const body = (await response.json()) as { error?: string };
      setNotice(
        body.error ?? `${entry.label} disconnected and its key removed.`,
      );
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!ready)
    return (
      <div className="flex items-center gap-2 text-[11px] text-white/45">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading providers…
      </div>
    );
  if (error) return <p className="text-[11px] text-rose-300">{error}</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[9px] uppercase tracking-wider text-white/28">
            Bring your own providers
          </p>
          <h2 className="mt-1 text-sm font-semibold">Provider marketplace</h2>
          <p className="mt-1 text-[11px] text-white/40">
            {connectedCount} verified · {storedCount} configured ·{' '}
            {catalog.length} available. Keys are encrypted per workspace.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter providers…"
            className="w-56 rounded-lg border border-white/10 bg-white/4 py-2 pl-8 pr-3 text-[11px] outline-none focus:border-white/25"
          />
        </div>
        <button
          type="button"
          onClick={() => setCategory(null)}
          className={`rounded-lg border px-3 py-1.5 text-[11px] transition ${
            category === null
              ? 'border-white/30 bg-white/10 text-white'
              : 'border-white/10 bg-white/4 text-white/55 hover:text-white/85'
          }`}
        >
          All
        </button>
        {categories.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setCategory(item.id)}
            className={`rounded-lg border px-3 py-1.5 text-[11px] transition ${
              category === item.id
                ? 'border-white/30 bg-white/10 text-white'
                : 'border-white/10 bg-white/4 text-white/55 hover:text-white/85'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {notice ? (
        <p className="rounded-lg border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] text-white/70">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {visible.length === 0 ? (
          <p className="text-[11px] text-white/35">
            No provider matches that filter.
          </p>
        ) : null}
        {visible.map((entry) => {
          const status = entry.connection?.status ?? '';
          const isOpen = openType === entry.id;
          return (
            <article
              key={entry.id}
              className={`rounded-2xl border p-4 transition ${
                isOpen
                  ? 'border-white/25 bg-white/[0.04]'
                  : 'border-white/8 bg-white/[0.02]'
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/6 text-[11px] font-semibold text-white/70">
                  {entry.monogram}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[12px] font-semibold">{entry.label}</p>
                    <span className="rounded-md bg-white/6 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white/45">
                      {entry.category}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-white/40">
                    {entry.blurb}
                  </p>
                </div>
                {status ? (
                  <span
                    className={`shrink-0 rounded-md border px-2 py-0.5 text-[9px] ${statusTone(status)}`}
                  >
                    {STATUS_LABEL[status] ?? status}
                  </span>
                ) : null}
              </div>

              {isOpen ? (
                <div className="mt-4 space-y-2.5">
                  {entry.fields.map((field: CredentialField) => (
                    <label key={field.key} className="block">
                      <span className="text-[10px] text-white/45">
                        {field.label}
                        {field.required ? '' : ' (optional)'}
                      </span>
                      <input
                        type={field.secret ? 'password' : 'text'}
                        autoComplete="off"
                        placeholder={field.placeholder}
                        value={form[field.key] ?? ''}
                        onChange={(event) =>
                          setForm({ ...form, [field.key]: event.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-[11px] outline-none focus:border-white/25"
                      />
                      {field.hint ? (
                        <span className="mt-1 block text-[9px] text-white/30">
                          {field.hint}
                        </span>
                      ) : null}
                    </label>
                  ))}
                  <p className="text-[9px] leading-relaxed text-white/32">
                    {entry.verifiable
                      ? 'Saved encrypted, then verified with a read-only call to the provider.'
                      : 'Saved encrypted. This provider has no read-only test endpoint, so it stays marked unverified until a real call uses it.'}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      className="portal-primary"
                      disabled={busy === `save-${entry.id}`}
                      onClick={() => void save(entry)}
                    >
                      {busy === `save-${entry.id}` ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Plug />
                      )}
                      Save key
                    </Button>
                    <Button onClick={() => setOpenType(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3.5 flex flex-wrap gap-2">
                  <Button onClick={() => openForm(entry)}>
                    {entry.connection ? 'Replace key' : 'Connect'}
                  </Button>
                  {entry.connection && entry.verifiable ? (
                    <Button
                      disabled={busy === `test-${entry.id}`}
                      onClick={() => void test(entry)}
                    >
                      {busy === `test-${entry.id}` ? (
                        <Loader2 className="animate-spin" />
                      ) : null}
                      Test
                    </Button>
                  ) : null}
                  {entry.connection ? (
                    <Button
                      disabled={busy === `drop-${entry.id}`}
                      onClick={() => void disconnect(entry)}
                      className="ml-auto"
                    >
                      <Trash2 />
                      Disconnect
                    </Button>
                  ) : null}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {unrecognised.length ? (
        <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-4">
          <h3 className="text-[11px] font-semibold text-amber-100">
            Stored connections outside the catalog
          </h3>
          <p className="mt-1 text-[10px] leading-relaxed text-amber-100/60">
            These hold an encrypted secret but no longer match a provider in the
            catalog, so nothing above can manage them. Disconnect any you no
            longer use.
          </p>
          <div className="mt-3 space-y-2">
            {unrecognised.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-[11px]"
              >
                <span className="font-mono text-[10px] text-white/70">
                  {row.type}
                </span>
                <span className="text-white/45">{row.name}</span>
                <span
                  className={`rounded-md border px-2 py-0.5 text-[9px] ${statusTone(row.status)}`}
                >
                  {STATUS_LABEL[row.status] ?? row.status}
                </span>
                <Button
                  className="ml-auto"
                  disabled={busy === `drop-${row.id}`}
                  onClick={async () => {
                    setBusy(`drop-${row.id}`);
                    try {
                      await fetch(
                        `/api/app/integrations?id=${encodeURIComponent(row.id)}`,
                        { method: 'DELETE' },
                      );
                      setNotice(`${row.type} disconnected.`);
                      await load();
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  <Trash2 />
                  Disconnect
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
