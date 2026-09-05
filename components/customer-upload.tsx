'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The customer's side of a document request.
 *
 * This is the only screen in the product built for somebody with no account,
 * on a phone, arriving from a WhatsApp message. So: one thing on it, large
 * text, no navigation, no branding they have never seen, and every refusal in
 * words rather than a status code. It says what will happen to the file
 * before they choose it, because "we do not scan for viruses" is true and a
 * person handing over an Aadhaar card is entitled to know what is and is not
 * being done with it.
 */

type Lookup = {
  document: string;
  open: boolean;
  reason: string;
  message: string;
  accepted: string[];
};

type Phase =
  | { kind: 'loading' }
  | { kind: 'closed'; message: string }
  | { kind: 'ready'; document: string; accepted: string[] }
  | { kind: 'sending'; document: string; accepted: string[] }
  | { kind: 'done'; document: string; note: string };

export function CustomerUpload({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/upload/${encodeURIComponent(token)}`,
          { cache: 'no-store' },
        );
        const payload = (await response.json()) as Lookup & { error?: string };
        if (cancelled) return;
        if (!response.ok || !payload.open) {
          setPhase({
            kind: 'closed',
            message:
              payload.message ||
              payload.error ||
              'This upload link is not valid. Ask for a new one.',
          });
          return;
        }
        setPhase({
          kind: 'ready',
          document: payload.document,
          accepted: payload.accepted ?? [],
        });
      } catch {
        if (!cancelled)
          setPhase({
            kind: 'closed',
            message:
              'We could not reach the server. Check your connection and open the link again.',
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const send = useCallback(
    async (file: File) => {
      setError(null);
      setPhase((current) =>
        current.kind === 'ready' ? { ...current, kind: 'sending' } : current,
      );
      const body = new FormData();
      body.append('file', file);
      try {
        const response = await fetch(
          `/api/upload/${encodeURIComponent(token)}`,
          { method: 'POST', body },
        );
        const payload = (await response.json()) as {
          received?: boolean;
          document?: string;
          note?: string;
          error?: string;
        };
        if (!response.ok || !payload.received) {
          setError(payload.error || 'The file was not accepted.');
          setPhase((current) =>
            current.kind === 'sending'
              ? { ...current, kind: 'ready' }
              : current,
          );
          return;
        }
        setPhase({
          kind: 'done',
          document: payload.document ?? '',
          note: payload.note ?? '',
        });
      } catch {
        setError(
          'The upload did not finish. Check your connection and try again.',
        );
        setPhase((current) =>
          current.kind === 'sending' ? { ...current, kind: 'ready' } : current,
        );
      }
    },
    [token],
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 bg-white px-5 py-10 text-[#111827]">
      {phase.kind === 'loading' ? (
        <p className="text-base text-[#4b5563]">Checking this link…</p>
      ) : null}

      {phase.kind === 'closed' ? (
        <section className="rounded-xl border border-[#e5e7eb] p-6">
          <h1 className="text-xl font-semibold">This link cannot be used</h1>
          <p className="mt-3 text-base leading-relaxed text-[#4b5563]">
            {phase.message}
          </p>
        </section>
      ) : null}

      {phase.kind === 'ready' || phase.kind === 'sending' ? (
        <section className="flex flex-col gap-5">
          <div>
            <h1 className="text-2xl font-semibold">
              Upload your {phase.document}
            </h1>
            <p className="mt-2 text-base leading-relaxed text-[#4b5563]">
              Choose the file or take a photo. One file, and this link closes
              once it arrives.
            </p>
          </div>

          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#cbd5e1] px-4 py-10 text-center hover:border-[#2563eb]">
            <span className="text-base font-medium">
              {phase.kind === 'sending' ? 'Sending…' : 'Choose a file'}
            </span>
            <span className="text-sm text-[#6b7280]">
              JPG, PNG, PDF — up to 20MB
            </span>
            <input
              type="file"
              className="sr-only"
              accept={phase.accepted.join(',')}
              disabled={phase.kind === 'sending'}
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared so choosing the same file again after a refusal
                // still fires a change event.
                event.target.value = '';
                if (file) void send(file);
              }}
            />
          </label>

          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-[#fef2f2] px-4 py-3 text-base leading-relaxed text-[#b91c1c]"
            >
              {error}
            </p>
          ) : null}

          <p className="text-sm leading-relaxed text-[#6b7280]">
            The file is stored by the business that asked for it and reviewed by
            a person there. Its contents are checked to confirm the file is the
            type it claims to be. It is not scanned for viruses.
          </p>
        </section>
      ) : null}

      {phase.kind === 'done' ? (
        <section className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] p-6">
          <h1 className="text-xl font-semibold text-[#166534]">
            Received{phase.document ? `: ${phase.document}` : ''}
          </h1>
          <p className="mt-3 text-base leading-relaxed text-[#15803d]">
            It has been passed to the team for review. You can close this page.
          </p>
          {phase.note ? (
            <p className="mt-3 text-sm leading-relaxed text-[#4b5563]">
              {phase.note}
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
