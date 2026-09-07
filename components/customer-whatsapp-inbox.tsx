'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Send } from 'lucide-react';

import { useT } from '@/components/locale-provider';
import type { Conversation, ReplyWindow } from '@/lib/whatsapp-inbox';

/**
 * The WhatsApp inbox.
 *
 * The webhook has been storing inbound messages and `/api/app/whatsapp-inbox`
 * has been able to read them since both were written, and nothing in the
 * product ever showed either — the messages arrived and went nowhere a person
 * could see.
 *
 * The reply box appears only while WhatsApp would actually deliver a typed
 * message: within 24 hours of the customer's last one. Outside that the box is
 * replaced by the reason, because a text box that produces a Meta error the
 * moment you press send is worse than no text box.
 */

type Thread = Conversation & { window: ReplyWindow };

export function CustomerWhatsAppInbox() {
  const t = useT();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [connected, setConnected] = useState(true);
  const [openPhone, setOpenPhone] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/app/whatsapp-inbox', {
        cache: 'no-store',
      });
      const body = (await response.json()) as {
        conversations?: Thread[];
        connected?: boolean;
        error?: string;
      };
      if (!response.ok) {
        setNotice(body.error ?? 'Could not load the inbox.');
        return;
      }
      setThreads(body.conversations ?? []);
      setConnected(body.connected !== false);
    } catch {
      setNotice('Could not load the inbox.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function reply(phone: string) {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setNotice('');
    try {
      const response = await fetch('/api/app/whatsapp-inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, text }),
      });
      const body = (await response.json()) as {
        error?: string;
        status?: string;
      };
      if (!response.ok) {
        setNotice(body.error ?? 'That did not send.');
        return;
      }
      // A sandbox send is not a delivery, and saying so here is the difference
      // between a workspace that knows its WhatsApp is not connected and one
      // that thinks it has been replying to customers.
      setNotice(
        body.status === 'sent'
          ? 'Sent.'
          : 'Recorded, but WhatsApp is not connected — nothing left this workspace.',
      );
      setDraft('');
      await load();
    } catch {
      setNotice('That did not send.');
    } finally {
      setSending(false);
    }
  }

  if (loading)
    return (
      <div className="flex items-center gap-2 text-[11px] text-ink-muted">
        <Loader2 className="size-3.5 animate-spin" /> Loading the inbox…
      </div>
    );

  const open = threads.find((thread) => thread.phone === openPhone) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {t('screen.whatsapp_inbox.title')}
        </h1>
        <p className="mt-1 text-[11px] text-ink-muted">
          {t('screen.whatsapp_inbox.description')}
        </p>
      </div>

      {!connected ? (
        <p className="rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-[11px] text-ink-body">
          WhatsApp is not connected for this workspace. Messages that arrive are
          still stored, and anything you send here is recorded but not
          delivered.
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-[11px] text-ink">
          {notice}
        </p>
      ) : null}

      <section className="portal-panel grid gap-4 p-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-1.5">
          {threads.length === 0 ? (
            <p className="text-[11px] text-ink-muted">
              Nothing yet. Messages appear here when a customer writes to your
              WhatsApp number.
            </p>
          ) : null}
          {threads.map((thread) => (
            <button
              key={thread.phone}
              type="button"
              onClick={() => {
                setOpenPhone(thread.phone);
                setDraft('');
                setNotice('');
              }}
              className={`w-full rounded-xl border px-3 py-2.5 text-left text-[11px] ${
                thread.phone === openPhone
                  ? 'border-primary/40 bg-primary/[0.06]'
                  : 'border-hairline hover:bg-surface-strong'
              }`}
            >
              <span className="block font-mono font-medium">
                {thread.phone}
              </span>
              <span className="mt-0.5 block truncate text-ink-muted">
                {thread.preview}
              </span>
              <span className="mt-1 block text-[11px] text-ink-muted">
                {thread.window.open
                  ? `${thread.window.hoursLeft}h to reply`
                  : 'reply window closed'}
              </span>
            </button>
          ))}
        </div>

        <div className="min-w-0">
          {!open ? (
            <p className="text-[11px] text-ink-muted">
              Choose a conversation to read it.
            </p>
          ) : (
            <>
              <div className="max-h-[26rem] space-y-2 overflow-y-auto rounded-xl border border-hairline bg-surface-muted/50 p-3">
                {open.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-[12px] leading-5 ${
                      message.direction === 'inbound'
                        ? 'bg-surface'
                        : 'ml-auto bg-primary text-primary-foreground'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">
                      {message.body ??
                        `[${message.message_type || 'attachment'}]`}
                    </p>
                    <p
                      className={`mt-1 text-[11px] ${
                        message.direction === 'inbound'
                          ? 'text-ink-muted'
                          : 'text-primary-foreground/70'
                      }`}
                    >
                      {message.created_at}
                    </p>
                  </div>
                ))}
              </div>

              {open.window.open ? (
                <div className="mt-3 flex items-end gap-2 rounded-xl border border-hairline bg-surface p-2">
                  <textarea
                    value={draft}
                    rows={2}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Reply…"
                    aria-label={`Reply to ${open.phone}`}
                    className="flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[12px] outline-none"
                  />
                  <button
                    type="button"
                    disabled={!draft.trim() || sending}
                    onClick={() => void reply(open.phone)}
                    aria-label="Send reply"
                    className="portal-primary rounded-lg px-3 py-2 text-[11px] disabled:opacity-40"
                  >
                    <Send className="size-3.5" />
                  </button>
                </div>
              ) : (
                <p className="mt-3 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5 text-[11px] text-ink-body">
                  {open.window.reason}
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
