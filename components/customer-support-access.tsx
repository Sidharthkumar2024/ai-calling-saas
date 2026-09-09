'use client';

import { useState } from 'react';
import { DoorOpen, Loader2, ShieldOff } from 'lucide-react';

/**
 * Letting a support executive into this workspace, and shutting the door.
 *
 * The whole mechanism was already built and reachable from nothing. A customer
 * issues a one-time PIN that expires in thirty minutes; an executive can open
 * a session only by quoting it, with a reason the customer reads; every record
 * they open during that session is counted; and the customer can revoke,
 * which ends any live session rather than only cancelling the PIN.
 *
 * With no screen on either side, a customer could not grant access and support
 * could not enter — a support model that existed entirely on paper.
 *
 * The PIN is shown once, here, and never stored anywhere it can be read back.
 * Reloading does not bring it back, and this says so before it is issued
 * rather than after.
 */

export type SupportAccess = {
  liveSessions: Record<string, unknown>[];
  recentSessions: Record<string, unknown>[];
  livePin: Record<string, unknown> | null;
};

const text = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;
const count = (value: unknown) => (typeof value === 'number' ? value : 0);

export function CustomerSupportAccess({
  access,
  onChanged,
}: {
  access: SupportAccess;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [issued, setIssued] = useState<{ pin: string; minutes: number } | null>(
    null,
  );
  const [notice, setNotice] = useState('');

  async function post(payload: Record<string, unknown>, key: string) {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/app/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) throw new Error(text(body.error, 'That did not work.'));
      return body;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work.');
      return null;
    } finally {
      setBusy('');
    }
  }

  const live = access.liveSessions ?? [];

  return (
    <section className="rounded-2xl border border-hairline bg-surface p-5">
      <h2 className="text-sm font-semibold">Support access</h2>
      <p className="mt-1 text-[11px] leading-4 text-ink-muted">
        Nobody from support can open your workspace without a code you give
        them. It works once and expires in thirty minutes.
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-[11px] text-danger-text">
          {error}
        </p>
      ) : null}
      {notice ? (
        <output className="mt-3 block text-[11px] text-success-text">
          {notice}
        </output>
      ) : null}

      {/* Somebody is inside right now. This is the part worth seeing first. */}
      {live.length ? (
        <div className="mt-3 rounded-xl border border-warning-text/30 bg-warning-text/[0.05] p-3 text-[11px]">
          <p className="font-medium text-warning-text">
            {live.length === 1
              ? 'Somebody from support is in your workspace.'
              : `${live.length} support sessions are open.`}
          </p>
          {live.map((session) => (
            <p key={text(session.id)} className="mt-1 text-ink-body">
              {text(session.executive_email, 'a support executive')} ·{' '}
              {text(session.reason, 'no reason given')} ·{' '}
              {count(session.view_count)} records opened · until{' '}
              {text(session.expires_at)}
            </p>
          ))}
        </div>
      ) : null}

      {issued ? (
        <div className="mt-3 rounded-xl border border-hairline bg-surface-muted p-3">
          <p className="text-[11px] text-ink-muted">
            Read this to the executive. It is shown once and cannot be shown
            again.
          </p>
          <p className="mt-1 font-mono text-lg tracking-[0.3em] text-ink">
            {issued.pin}
          </p>
          <p className="mt-1 text-[11px] text-ink-muted">
            Works once, for the next {issued.minutes} minutes.
          </p>
        </div>
      ) : null}

      {access.livePin && !issued ? (
        <p className="mt-3 text-[11px] text-ink-muted">
          A code is already live until {text(access.livePin.expires_at)}.
          Issuing another cancels it.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="What are they helping with?"
          aria-label="Reason for support access"
          className="min-w-[200px] flex-1 rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[11px]"
        />
        <button
          type="button"
          disabled={busy === 'issue'}
          onClick={async () => {
            const body = await post(
              { action: 'issue_support_pin', reason: reason.trim() },
              'issue',
            );
            if (body) {
              setIssued({
                pin: text(body.pin),
                minutes: Number(body.expiresInMinutes ?? 30),
              });
              setReason('');
              await onChanged();
            }
          }}
          className="portal-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] disabled:opacity-40"
        >
          {busy === 'issue' ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <DoorOpen className="size-3.5" />
          )}
          Give support a code
        </button>
        {live.length || access.livePin ? (
          <button
            type="button"
            disabled={busy === 'revoke'}
            onClick={async () => {
              const body = await post(
                { action: 'revoke_support_access' },
                'revoke',
              );
              if (body) {
                setIssued(null);
                // How many sessions closed is the part somebody needs: it is
                // the difference between cancelling a code nobody used and
                // shutting a door that was standing open.
                const ended = Number(body.sessionsEnded ?? 0);
                setNotice(
                  ended
                    ? `Access revoked. ${ended} open session${ended === 1 ? '' : 's'} ended.`
                    : 'Access revoked. No session was open.',
                );
                await onChanged();
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-[11px] text-danger-text disabled:opacity-40"
          >
            <ShieldOff className="size-3.5" /> Revoke access
          </button>
        ) : null}
      </div>

      {(access.recentSessions ?? []).length ? (
        <div className="mt-4 space-y-1">
          <p className="text-[11px] text-ink-muted">Earlier visits</p>
          {(access.recentSessions ?? []).map((session) => (
            <p
              key={text(session.id)}
              className="rounded-lg border border-hairline px-2.5 py-1.5 text-[11px] text-ink-body"
            >
              {text(session.executive_email, 'a support executive')} ·{' '}
              {text(session.reason, 'no reason given')} ·{' '}
              {count(session.view_count)} records opened ·{' '}
              {text(session.created_at)}
              {text(session.ended_reason)
                ? ` · ended: ${text(session.ended_reason).replaceAll('_', ' ')}`
                : ''}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
