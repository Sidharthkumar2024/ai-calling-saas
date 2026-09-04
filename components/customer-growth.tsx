'use client';

import { useCallback, useEffect, useState } from 'react';

import { DISCOVERY_QUESTIONS, type Confidence } from '@/lib/growth-manager';

/**
 * The AI Business Manager (§6).
 *
 * Two halves. The discovery interview, which is §3's front door — the platform
 * asks the business about itself instead of presenting thirty configuration
 * screens. And the evidence board, which is the half that has to earn trust:
 * every observation shows the number, where it came from and how much data is
 * behind it, and every recommendation shows the observations it rests on.
 *
 * A recommendation with no evidence is never rendered because it is never
 * constructed — see `recommend` in `lib/growth-manager.ts`.
 */

type Observation = {
  id: string;
  statement: string;
  source: string;
  metric: { label: string; value: number; unit?: string };
  sampleSize: number;
  confidence: Confidence;
};

type Board = {
  discovery: {
    answers: Record<string, string>;
    progress: number;
    complete: boolean;
    missingRequired: string[];
  };
  observations: Observation[];
  recommendations: Array<{
    id: string;
    title: string;
    action: string;
    area: string;
    evidence: string[];
    confidence: Confidence;
  }>;
  sources: {
    connected: string[];
    pending: Array<{ id: string; label: string }>;
  };
  notEnoughData: string | null;
  measuredAt: string;
};

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: 'text-success-text',
  medium: 'text-ink-body',
  low: 'text-warning-text',
};

export function CustomerGrowth() {
  const [board, setBoard] = useState<Board | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/app/growth', { cache: 'no-store' });
      const body = (await response.json()) as Board & { error?: string };
      if (!response.ok) {
        setError(body.error ?? 'Could not load the business manager.');
        return;
      }
      setBoard(body);
      setAnswers(body.discovery.answers ?? {});
      setError('');
    } catch {
      setError('Could not load the business manager.');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function saveDiscovery() {
    setSaving(true);
    try {
      await fetch('/api/app/growth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'save_discovery', answers }),
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (error)
    return (
      <p role="alert" className="text-[11px] text-danger-text">
        {error}
      </p>
    );
  if (!board) return null;

  const byId = new Map(board.observations.map((item) => [item.id, item]));

  return (
    <div className="space-y-6">
      <section className="portal-panel p-5">
        <h2 className="text-sm font-semibold">Tell me about your business</h2>
        <p className="mt-1 text-[10px] text-ink-muted">
          Every answer changes something: the agent’s opening, what it qualifies
          for, and how this board ranks its advice.
        </p>
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-strong">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.round(board.discovery.progress * 100)}%` }}
          />
        </div>
        <div className="mt-4 space-y-3">
          {DISCOVERY_QUESTIONS.map((question) => (
            <label key={question.id} className="block">
              <span className="text-[11px] font-medium">
                {question.question}
                {question.required ? null : (
                  <span className="ml-1 text-[9px] text-ink-muted">
                    optional
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-[9px] text-ink-muted">
                {question.purpose}
              </span>
              <textarea
                rows={2}
                value={answers[question.id] ?? ''}
                onChange={(event) =>
                  setAnswers({ ...answers, [question.id]: event.target.value })
                }
                className="mt-1.5 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[11px]"
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveDiscovery()}
          className="portal-primary mt-3 rounded-lg px-4 py-2 text-[11px] disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </section>

      <section className="portal-panel p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Evidence board</h2>
          <span className="text-[9px] text-ink-muted">
            measured {board.measuredAt.slice(0, 16).replace('T', ' ')}
          </span>
        </div>
        <p className="mt-1 text-[10px] text-ink-muted">
          Every line is measured from your own calls and leads. Nothing here is
          an opinion, and anything with too little data behind it is left out
          rather than shown faintly.
        </p>

        {board.notEnoughData ? (
          <p className="mt-4 rounded-xl border border-hairline bg-surface-muted px-3 py-3 text-[11px] text-ink-body">
            {board.notEnoughData}
          </p>
        ) : null}

        <div className="mt-4 space-y-2">
          {board.observations.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5 text-[11px]"
            >
              <span className="font-mono text-[12px] font-semibold">
                {item.metric.value}
                {item.metric.unit ?? ''}
              </span>
              <span className="flex-1">{item.statement}</span>
              <span className="text-[9px] text-ink-muted">
                from {item.source} · {item.sampleSize} records
              </span>
              <span
                className={`text-[9px] font-semibold ${CONFIDENCE_STYLE[item.confidence]}`}
              >
                {item.confidence} confidence
              </span>
            </div>
          ))}
        </div>

        {/* §6 asks for four more sources. None is connected, and saying so is
            the difference between an empty board and a complete one. */}
        <p className="mt-4 text-[9px] text-ink-muted">
          Reading from: {board.sources.connected.join(', ')}. Not yet connected:{' '}
          {board.sources.pending.map((item) => item.label).join(', ')} — nothing
          on this board claims to come from them.
        </p>
      </section>

      <section className="portal-panel p-5">
        <h2 className="text-sm font-semibold">Growth plan</h2>
        <p className="mt-1 text-[10px] text-ink-muted">
          Ordered by how much evidence is behind each one, not by how important
          it sounds.
        </p>
        {board.recommendations.length === 0 ? (
          <p className="mt-4 text-[11px] text-ink-muted">
            Nothing to recommend yet. A recommendation here has to cite
            something measured, so this fills up as you run calls.
          </p>
        ) : null}
        <div className="mt-4 space-y-2">
          {board.recommendations.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-hairline bg-surface-muted px-3 py-2.5"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[11px] font-medium">{item.title}</span>
                <span className="text-[9px] text-ink-muted">{item.area}</span>
                <span
                  className={`ml-auto text-[9px] font-semibold ${CONFIDENCE_STYLE[item.confidence]}`}
                >
                  {item.confidence} confidence
                </span>
              </div>
              <p className="mt-1 text-[10px] text-ink-body">{item.action}</p>
              <ul className="mt-2 space-y-0.5">
                {item.evidence.map((id) => (
                  <li key={id} className="text-[9px] text-ink-muted">
                    ↳ {byId.get(id)?.statement ?? id}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
