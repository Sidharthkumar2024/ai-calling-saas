'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

/**
 * What is actually inside a knowledge base.
 *
 * `/api/app/knowledge` could ingest a source — pasted text or a public URL,
 * chunked and stored — since the day it shipped, and **nothing in the product
 * ever called it**. So a knowledge base could be created and never filled: an
 * empty shelf with a name on it, while every agent's prompt said to answer
 * only from approved knowledge.
 *
 * This is the missing half. It shows what each base holds and lets a person
 * put something in it.
 */

type Source = {
  id: string;
  name: string;
  knowledge_base_id: string;
  knowledge_base_name: string;
  source_url: string | null;
  status: string;
  chunk_count: number;
  created_at: string;
};

export function KnowledgeSources({
  bases,
  onChanged,
}: {
  bases: Array<{ id: string; name: string }>;
  onChanged: () => Promise<void> | void;
}) {
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState({
    knowledgeBaseId: '',
    name: '',
    text: '',
    url: '',
  });

  const load = useCallback(async () => {
    const response = await fetch('/api/app/knowledge');
    if (!response.ok) return;
    const payload = (await response.json()) as { sources?: Source[] };
    setSources(payload.sources ?? []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function add() {
    setBusy(true);
    setProblem('');
    setNotice('');
    try {
      const response = await fetch('/api/app/knowledge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          knowledgeBaseId: draft.knowledgeBaseId || bases[0]?.id,
          name: draft.name,
          text: draft.text || undefined,
          url: draft.url || undefined,
        }),
      });
      // The field is `chunks`, not `chunkCount`. Reading a name the API does
      // not return is exactly how the team screen came to show nothing at all.
      const payload = (await response.json()) as {
        error?: string;
        chunks?: number;
      };
      if (!response.ok) {
        setProblem(payload.error ?? 'That source could not be added.');
        return;
      }
      // The chunk count is the honest measure of whether anything usable came
      // out: a page that fetched but yielded nothing readable is not a source.
      setNotice(
        payload.chunks
          ? `Added — ${payload.chunks} ${payload.chunks === 1 ? 'passage' : 'passages'} your agents can quote.`
          : 'Added, but nothing readable came out of it. Check the page or paste the text instead.',
      );
      setDraft({
        knowledgeBaseId: draft.knowledgeBaseId,
        name: '',
        text: '',
        url: '',
      });
      await load();
      await onChanged();
    } catch {
      setProblem('That source could not be added.');
    } finally {
      setBusy(false);
    }
  }

  const byBase = new Map<string, Source[]>();
  for (const source of sources) {
    const list = byBase.get(source.knowledge_base_id) ?? [];
    list.push(source);
    byBase.set(source.knowledge_base_id, list);
  }

  return (
    <section className="portal-panel p-5">
      <h2 className="text-sm font-semibold">What is in your knowledge bases</h2>
      <p className="mt-1 max-w-2xl text-[10px] text-ink-muted">
        Your agents are told to answer only from approved knowledge. This is
        that knowledge — paste the text, or give a public page to read. An empty
        base means the agent has nothing to answer from.
      </p>

      {bases.length === 0 ? (
        <p className="mt-3 text-[11px] text-ink-muted">
          Create a knowledge base first, then add sources to it.
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[10px] text-ink-muted">
              Add to
              <select
                value={draft.knowledgeBaseId || bases[0]?.id}
                onChange={(event) =>
                  setDraft({ ...draft, knowledgeBaseId: event.target.value })
                }
                className="h-9 rounded-lg border border-hairline bg-surface px-2.5 text-[11px] text-ink-body"
              >
                {bases.map((base) => (
                  <option key={base.id} value={base.id}>
                    {base.name}
                  </option>
                ))}
              </select>
            </label>
            <label
              htmlFor="kb-source-name"
              className="flex flex-col gap-1 text-[10px] text-ink-muted"
            >
              What is this source called?
              <Input
                id="kb-source-name"
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                placeholder="Price list — September"
              />
            </label>
            <label
              htmlFor="kb-source-text"
              className="flex flex-col gap-1 text-[10px] text-ink-muted sm:col-span-2"
            >
              Paste the content
              <Textarea
                id="kb-source-text"
                rows={4}
                value={draft.text}
                onChange={(event) =>
                  setDraft({ ...draft, text: event.target.value })
                }
                placeholder="Tower A, 3BHK, 1450 sq ft carpet, ₹1.95 Cr, possession Dec 2027…"
              />
            </label>
            <label
              htmlFor="kb-source-url"
              className="flex flex-col gap-1 text-[10px] text-ink-muted sm:col-span-2"
            >
              …or read a public page instead
              <Input
                id="kb-source-url"
                value={draft.url}
                onChange={(event) =>
                  setDraft({ ...draft, url: event.target.value })
                }
                placeholder="https://yoursite.com/pricing"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button
              type="button"
              className="portal-primary"
              disabled={
                busy ||
                !draft.name.trim() ||
                (!draft.text.trim() && !draft.url.trim())
              }
              onClick={() => void add()}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              Add source
            </Button>
            {notice ? (
              <span className="text-[10px] text-ink-body">{notice}</span>
            ) : null}
            {problem ? (
              <span role="alert" className="text-[10px] text-danger-text">
                {problem}
              </span>
            ) : null}
          </div>
        </>
      )}

      <div className="mt-5 space-y-3">
        {bases.map((base) => {
          const list = byBase.get(base.id) ?? [];
          return (
            <div
              key={base.id}
              className="rounded-lg border border-hairline bg-surface px-3 py-2.5"
            >
              <p className="text-[11px] font-medium">
                {base.name}
                <span className="ml-2 text-[10px] font-normal text-ink-muted">
                  {list.length === 0
                    ? 'empty — your agents have nothing to answer from here'
                    : `${list.length} ${list.length === 1 ? 'source' : 'sources'}`}
                </span>
              </p>
              {list.map((source) => (
                <p key={source.id} className="mt-1 text-[10px] text-ink-muted">
                  {source.name}
                  {' · '}
                  {source.chunk_count}{' '}
                  {source.chunk_count === 1 ? 'passage' : 'passages'}
                  {source.source_url ? ` · ${source.source_url}` : ''}
                  {source.status && source.status !== 'ready'
                    ? ` · ${source.status.replaceAll('_', ' ')}`
                    : ''}
                </p>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
