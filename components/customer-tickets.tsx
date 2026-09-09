'use client';

import { useState } from 'react';
import {
  CustomerSupportAccess,
  type SupportAccess,
} from '@/components/customer-support-access';
import { LifeBuoy, Loader2, MessageSquareText, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type TicketsData = {
  tickets: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  supportAccess?: SupportAccess;
};

export function CustomerTickets({
  data,
  onChanged,
}: {
  data: TicketsData;
  onChanged: () => Promise<void> | void;
}) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replying, setReplying] = useState('');
  const [replyError, setReplyError] = useState<Record<string, string>>({});
  async function create() {
    if (!subject.trim() || !message.trim()) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/app/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          subject,
          message,
          category: 'technical',
          priority: 'normal',
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? 'Unable to create ticket.');
      setSubject('');
      setMessage('');
      await onChanged();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to create ticket.',
      );
    } finally {
      setLoading(false);
    }
  }

  /**
   * Answering. Admin replies were already rendered here and the screen already
   * promised "follow the conversation" — but the only thing a customer could
   * send was a new ticket. An admin reply even sets the ticket to
   * `waiting_on_customer`, which is the product saying it is waiting for
   * somebody who had nowhere to type.
   */
  async function reply(ticketId: string) {
    const draft = (drafts[ticketId] ?? '').trim();
    if (!draft) return;
    setReplying(ticketId);
    setReplyError((current) => ({ ...current, [ticketId]: '' }));
    try {
      const response = await fetch('/api/app/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'reply', ticketId, message: draft }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Unable to send reply.');
      setDrafts((current) => ({ ...current, [ticketId]: '' }));
      await onChanged();
    } catch (caught) {
      setReplyError((current) => ({
        ...current,
        [ticketId]:
          caught instanceof Error ? caught.message : 'Unable to send reply.',
      }));
    } finally {
      setReplying('');
    }
  }
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700">
          Customer support
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Support tickets</h1>
        <p className="mt-2 text-xs text-ink-muted">
          Raise an issue, follow the conversation and receive platform-admin
          responses inside your workspace.
        </p>
      </div>
      <CustomerSupportAccess
        access={
          data.supportAccess ?? {
            liveSessions: [],
            recentSessions: [],
            livePin: null,
          }
        }
        onChanged={onChanged}
      />
      <div className="grid gap-4 xl:grid-cols-[0.75fr_1.25fr]">
        <section className="rounded-2xl border border-hairline bg-surface p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-cyan-300/7">
              <LifeBuoy className="size-4 text-cyan-700" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Open a ticket</h2>
              <p className="text-[11px] text-ink-muted">
                Sent to the admin portal
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <Input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Subject"
              className="border-hairline bg-surface-muted"
            />
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Describe the issue"
              className="min-h-28 w-full rounded-xl border border-hairline bg-surface-muted p-3 text-xs outline-none placeholder:text-ink-muted"
            />
            {error ? <p className="text-xs text-danger-text">{error}</p> : null}
            <Button
              onClick={create}
              disabled={loading || !subject.trim() || !message.trim()}
              className="w-full bg-primary text-[#07101e] hover:bg-cyan-200"
            >
              {loading ? <Loader2 className="animate-spin" /> : <Plus />}Create
              ticket
            </Button>
          </div>
        </section>
        <div className="space-y-3">
          {data.tickets.map((ticket) => {
            const messages = data.messages.filter(
              (item) => item.ticket_id === ticket.id,
            );
            const settled = ['resolved', 'closed'].includes(
              String(ticket.status),
            );
            return (
              <section
                key={String(ticket.id)}
                className="rounded-2xl border border-hairline bg-surface p-5"
              >
                <div className="flex items-start gap-3">
                  <MessageSquareText className="mt-0.5 size-4 text-cyan-700" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-sm font-semibold">
                        {String(ticket.subject)}
                      </h2>
                      <span className="rounded-full bg-surface-strong px-2 py-1 text-[11px] capitalize text-ink-muted">
                        {String(ticket.status).replaceAll('_', ' ')}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-muted">
                      {String(ticket.category)} · {String(ticket.priority)}{' '}
                      priority
                    </p>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {messages.map((item) => (
                    <div
                      key={String(item.id)}
                      className={`rounded-xl border p-3 text-[11px] leading-5 ${item.sender_role === 'admin' ? 'border-cyan-300/10 bg-cyan-300/[0.035]' : 'border-hairline bg-surface-muted'}`}
                    >
                      <p className="mb-1 text-[11px] uppercase tracking-wider text-ink-muted">
                        {String(item.sender_name)} · {String(item.sender_role)}
                      </p>
                      {String(item.message)}
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-2">
                  <textarea
                    value={drafts[String(ticket.id)] ?? ''}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [String(ticket.id)]: event.target.value,
                      }))
                    }
                    placeholder="Reply to support"
                    aria-label={`Reply to ${String(ticket.subject)}`}
                    className="min-h-20 w-full rounded-xl border border-hairline bg-surface-muted p-3 text-xs outline-none placeholder:text-ink-muted"
                  />
                  {settled ? (
                    <p className="text-[11px] text-ink-muted">
                      This ticket is {String(ticket.status)}. Replying opens it
                      again.
                    </p>
                  ) : null}
                  {replyError[String(ticket.id)] ? (
                    <p className="text-xs text-danger-text">
                      {replyError[String(ticket.id)]}
                    </p>
                  ) : null}
                  <Button
                    onClick={() => void reply(String(ticket.id))}
                    disabled={
                      replying === String(ticket.id) ||
                      !(drafts[String(ticket.id)] ?? '').trim()
                    }
                    className="bg-primary text-[#07101e] hover:bg-cyan-200"
                  >
                    {replying === String(ticket.id) ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <MessageSquareText />
                    )}
                    Send reply
                  </Button>
                </div>
              </section>
            );
          })}
          {!data.tickets.length ? (
            <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-hairline text-xs text-ink-muted">
              No tickets yet.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
