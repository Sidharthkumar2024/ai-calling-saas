'use client';

import { useState } from 'react';
import { Loader2, Search, ShieldOff, ShieldCheck } from 'lucide-react';

/**
 * Consent and the do-not-contact list.
 *
 * Both decide whether this workspace may call or message somebody: the dialer
 * skips a contact with no consent and a contact on the suppression list, and
 * every WhatsApp sender checks the same list. The panel here reported three
 * counts and the sentence "outbound call creation is rejected unless consent
 * is valid and the number is not suppressed" — the rule, with no way to
 * satisfy it. Recording consent, revoking it, and honouring somebody asking
 * not to be contacted were all handled by the API and reachable from nothing.
 *
 * The suppression list stores a hash and never the number, so it cannot be
 * listed back. That is deliberate, and it means the only question anybody
 * actually asks — is *this* person on it — needs a lookup rather than a table.
 */

type Consent = Record<string, unknown>;

const text = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;

export function CustomerCompliance({
  consents,
  suppressionCount,
  onChanged,
}: {
  consents: Consent[];
  suppressionCount: number;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [consentPhone, setConsentPhone] = useState('');
  const [purpose, setPurpose] = useState('outbound_calling');
  const [expiresAt, setExpiresAt] = useState('');

  const [dncPhone, setDncPhone] = useState('');
  const [dncReason, setDncReason] = useState('');

  const [lookupPhone, setLookupPhone] = useState('');
  const [lookup, setLookup] = useState<{
    suppressed: boolean;
    entry: Record<string, unknown> | null;
    consent: Record<string, unknown> | null;
  } | null>(null);

  async function post(payload: Record<string, unknown>, key: string) {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/app/compliance', {
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

  const granted = consents.filter((row) => text(row.status) === 'granted');

  return (
    <section className="portal-panel space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold">Consent and do-not-contact</h2>
        <p className="mt-1 text-[11px] leading-4 text-ink-muted">
          A campaign skips anybody without consent and anybody on this list, and
          every WhatsApp message checks the list too. {granted.length} active
          consent {granted.length === 1 ? 'record' : 'records'} ·{' '}
          {suppressionCount} suppressed{' '}
          {suppressionCount === 1 ? 'contact' : 'contacts'}.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-[11px] text-danger-text">
          {error}
        </p>
      ) : null}
      {notice ? (
        <output className="block text-[11px] text-success-text">
          {notice}
        </output>
      ) : null}

      {/* The question people actually ask about a hashed list. */}
      <div className="rounded-xl border border-hairline bg-surface-muted p-3">
        <label className="text-[11px] text-ink-muted" htmlFor="dnc-lookup">
          Is this number on the list?
        </label>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <input
            id="dnc-lookup"
            value={lookupPhone}
            onChange={(event) => setLookupPhone(event.target.value)}
            placeholder="+919812345678"
            className="min-w-[190px] flex-1 rounded-lg border border-hairline bg-surface px-2 py-1.5 font-mono text-[11px]"
          />
          <button
            type="button"
            disabled={busy === 'lookup' || !lookupPhone.trim()}
            onClick={async () => {
              setLookup(null);
              const body = await post(
                { action: 'check_suppression', phone: lookupPhone.trim() },
                'lookup',
              );
              if (body)
                setLookup(
                  body as unknown as {
                    suppressed: boolean;
                    entry: Record<string, unknown> | null;
                    consent: Record<string, unknown> | null;
                  },
                );
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-[11px] disabled:opacity-40"
          >
            {busy === 'lookup' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Search className="size-3.5" />
            )}
            Check
          </button>
        </div>
        {lookup ? (
          <div className="mt-2 space-y-1 text-[11px]">
            <p
              className={
                lookup.suppressed ? 'text-danger-text' : 'text-ink-body'
              }
            >
              {lookup.suppressed
                ? `On the do-not-contact list${
                    text(lookup.entry?.reason)
                      ? ` — ${text(lookup.entry?.reason)}`
                      : ''
                  }. Nothing will be called or messaged to this number.`
                : 'Not on the do-not-contact list.'}
            </p>
            <p className="text-ink-muted">
              {lookup.consent
                ? `Consent ${text(lookup.consent.status)} · ${text(lookup.consent.purpose, 'outbound_calling')} · recorded ${text(lookup.consent.captured_at)}`
                : 'No consent recorded for this number.'}
            </p>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Honouring somebody asking not to be contacted. */}
        <div className="rounded-xl border border-hairline p-3">
          <p className="text-[11px] font-medium">Add to do-not-contact</p>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            Takes effect on the next call and the next message. Any consent held
            for this number is revoked at the same time.
          </p>
          <input
            value={dncPhone}
            onChange={(event) => setDncPhone(event.target.value)}
            placeholder="+919812345678"
            aria-label="Number to suppress"
            className="mt-2 w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 font-mono text-[11px]"
          />
          <input
            value={dncReason}
            onChange={(event) => setDncReason(event.target.value)}
            placeholder="Why — e.g. asked us on the call not to be called again"
            aria-label="Reason for suppression"
            className="mt-1.5 w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[11px]"
          />
          <button
            type="button"
            disabled={busy === 'suppress' || !dncPhone.trim()}
            onClick={async () => {
              const body = await post(
                {
                  action: 'suppress',
                  phone: dncPhone.trim(),
                  reason: dncReason.trim(),
                },
                'suppress',
              );
              if (body) {
                setNotice(
                  'Added. This number will not be called or messaged again.',
                );
                setDncPhone('');
                setDncReason('');
                await onChanged();
              }
            }}
            className="portal-primary mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] disabled:opacity-40"
          >
            <ShieldOff className="size-3.5" /> Add to list
          </button>
        </div>

        {/* Recording that somebody agreed to be called. */}
        <div className="rounded-xl border border-hairline p-3">
          <p className="text-[11px] font-medium">Record consent</p>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            A campaign skips a contact with no consent on file, and says so.
          </p>
          <input
            value={consentPhone}
            onChange={(event) => setConsentPhone(event.target.value)}
            placeholder="+919812345678"
            aria-label="Number consent was given for"
            className="mt-2 w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 font-mono text-[11px]"
          />
          <div className="mt-1.5 flex gap-2">
            <input
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              aria-label="What they agreed to"
              className="min-w-0 flex-1 rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[11px]"
            />
            <input
              type="date"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              aria-label="Consent expires on"
              className="rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[11px]"
            />
          </div>
          <button
            type="button"
            disabled={busy === 'consent' || !consentPhone.trim()}
            onClick={async () => {
              const body = await post(
                {
                  action: 'grant_consent',
                  phone: consentPhone.trim(),
                  purpose,
                  expiresAt: expiresAt || undefined,
                },
                'consent',
              );
              if (body) {
                setNotice('Consent recorded.');
                setConsentPhone('');
                setExpiresAt('');
                await onChanged();
              }
            }}
            className="portal-primary mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] disabled:opacity-40"
          >
            <ShieldCheck className="size-3.5" /> Record it
          </button>
        </div>
      </div>

      {granted.length ? (
        <div className="space-y-1.5">
          <p className="text-[11px] text-ink-muted">Consent on file</p>
          {granted.slice(0, 20).map((row) => (
            <div
              key={text(row.id)}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline px-3 py-2 text-[11px]"
            >
              <span className="font-mono">{text(row.phone)}</span>
              <span className="text-ink-muted">
                {text(row.purpose, 'outbound_calling')}
              </span>
              <span className="text-ink-muted">
                {text(row.expires_at)
                  ? `expires ${text(row.expires_at)}`
                  : 'no expiry'}
              </span>
              <button
                type="button"
                disabled={busy === text(row.id)}
                onClick={async () => {
                  const body = await post(
                    { action: 'revoke_consent', consentId: text(row.id) },
                    text(row.id),
                  );
                  if (body) {
                    setNotice('Consent revoked.');
                    await onChanged();
                  }
                }}
                className="ml-auto rounded-lg border border-hairline px-2.5 py-1 text-[11px] text-danger-text disabled:opacity-40"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
