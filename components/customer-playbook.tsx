'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The mined company playbook (§13.1).
 *
 * §13.1 puts "Human reviews" between the mining and any use of it, and this
 * screen is that step. Entries arrive as proposals and nothing reaches a live
 * call until somebody approves that specific row — the difference between
 * "the counts noticed a pattern" and "this company says this is how we sell".
 *
 * Every row shows the counts it rests on, and the correlation caveat sits at
 * the top rather than being left to be inferred: a phrase common in calls that
 * closed did not close them.
 */

type Entry = {
  id: string;
  section: 'winning_phrase' | 'losing_phrase' | 'vocabulary' | 'objection';
  content: string;
  evidence: string;
  confidence: 'low' | 'medium' | 'high';
  status: string;
};

type Playbook = {
  id: string;
  callsRead: number;
  wonCount: number;
  lostCount: number;
  blocked: string | null;
  excluded: Array<{ outcome: string; count: number; reason: string }>;
  createdAt: string;
  entries: Entry[];
  approved: number;
  proposed: number;
};

const SECTION_TITLE: Record<Entry['section'], string> = {
  winning_phrase: 'Came up in calls that closed',
  losing_phrase: 'Came up in calls that did not',
  objection: 'Objections callers raised',
  vocabulary: 'Words your customers use',
};

export function CustomerPlaybook() {
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [caveat, setCaveat] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/app/playbook');
    if (!response.ok) return;
    const payload = (await response.json()) as {
      playbook: Playbook | null;
      caveat: string;
    };
    setPlaybook(payload.playbook);
    setCaveat(payload.caveat);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function mine() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/app/playbook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'mine' }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        reason?: string;
        callsRead?: number;
        entries?: number;
        blocked?: string | null;
        consentNote?: string | null;
        playgroundExcluded?: number;
      };
      if (!payload.ok) setNotice(payload.reason ?? 'Nothing could be mined.');
      else {
        const parts = [
          `Read ${payload.callsRead} calls and proposed ${payload.entries} entries.`,
        ];
        if (payload.blocked) parts.push(payload.blocked);
        if (payload.consentNote) parts.push(payload.consentNote);
        if (payload.playgroundExcluded)
          parts.push(
            `${payload.playgroundExcluded} playground tests were left out.`,
          );
        setNotice(parts.join(' '));
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function review(entryId: string, status: 'approved' | 'rejected') {
    await fetch('/api/app/playbook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'review', entryId, status }),
    });
    await load();
  }

  const sections: Entry['section'][] = [
    'winning_phrase',
    'losing_phrase',
    'objection',
    'vocabulary',
  ];

  return (
    <div className="space-y-6">
      <section className="portal-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Company playbook</h2>
            <p className="mt-1 max-w-2xl text-[10px] text-ink-muted">
              Reads your own past calls, splits the ones that closed from the
              ones that did not, and reports what separates them. Playground
              tests are left out — those are you talking to your own agent, not
              a customer.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void mine()}
            className="portal-primary rounded-lg px-4 py-2 text-[11px] disabled:opacity-60"
          >
            {busy
              ? 'Reading calls…'
              : playbook
                ? 'Mine again'
                : 'Mine my calls'}
          </button>
        </div>
        {notice ? (
          <p className="mt-3 text-[10px] text-ink-muted">{notice}</p>
        ) : null}
        {caveat ? (
          /* At the top, not the bottom. Every row below is a correlation. */
          <p className="mt-3 rounded-lg border border-hairline bg-surface-muted p-2.5 text-[10px] text-ink-body">
            {caveat}
          </p>
        ) : null}
      </section>

      {playbook ? (
        <>
          <section className="portal-panel p-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Calls read', playbook.callsRead],
                ['Closed', playbook.wonCount],
                ['Did not close', playbook.lostCount],
                ['Approved so far', playbook.approved],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <p className="text-[9px] uppercase tracking-wide text-ink-muted">
                    {label}
                  </p>
                  <p className="mt-0.5 text-lg font-semibold">{value}</p>
                </div>
              ))}
            </div>
            {playbook.blocked ? (
              <p className="mt-3 text-[10px] text-warning-text">
                {playbook.blocked}
              </p>
            ) : null}
            {playbook.excluded.length > 0 ? (
              /* What was left out, alongside what was used. */
              <p className="mt-2 text-[9px] text-ink-muted">
                Left out:{' '}
                {playbook.excluded
                  .map(
                    (entry) =>
                      `${entry.count} × ${entry.outcome.replaceAll('_', ' ')}`,
                  )
                  .join(', ')}
                . An outcome that is neither a win nor a loss would corrupt the
                comparison, so it is not forced into one.
              </p>
            ) : null}
          </section>

          {sections.map((section) => {
            const rows = playbook.entries.filter(
              (entry) => entry.section === section,
            );
            if (rows.length === 0) return null;
            return (
              <section key={section} className="portal-panel p-5">
                <h3 className="text-[11px] font-semibold">
                  {SECTION_TITLE[section]}
                </h3>
                <div className="mt-3 space-y-2">
                  {rows.map((entry) => (
                    <div
                      key={entry.id}
                      className={`rounded-lg border px-3 py-2.5 ${
                        entry.status === 'approved'
                          ? 'border-success-text/40 bg-surface-muted'
                          : entry.status === 'rejected'
                            ? 'border-hairline bg-surface opacity-50'
                            : 'border-hairline bg-surface'
                      }`}
                    >
                      <p className="text-[11px] font-medium">{entry.content}</p>
                      <p className="mt-0.5 text-[9px] text-ink-muted">
                        {entry.evidence} Confidence: {entry.confidence}, from
                        how many calls were read.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={entry.status === 'approved'}
                          onClick={() => void review(entry.id, 'approved')}
                          className="rounded-full border border-hairline px-2.5 py-1 text-[10px] disabled:opacity-45"
                        >
                          {entry.status === 'approved'
                            ? 'Approved ✓'
                            : 'Approve'}
                        </button>
                        <button
                          type="button"
                          disabled={entry.status === 'rejected'}
                          onClick={() => void review(entry.id, 'rejected')}
                          className="rounded-full border border-hairline px-2.5 py-1 text-[10px] disabled:opacity-45"
                        >
                          {entry.status === 'rejected' ? 'Rejected' : 'Reject'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}

          <p className="text-[9px] text-ink-muted">
            {playbook.approved > 0
              ? `${playbook.approved} approved ${playbook.approved === 1 ? 'entry is' : 'entries are'} in the agent’s instructions on live calls, with their counts attached so it can weigh them against what the caller is actually saying.`
              : 'Nothing is approved yet, so none of this reaches a live call.'}
          </p>
        </>
      ) : null}
    </div>
  );
}
