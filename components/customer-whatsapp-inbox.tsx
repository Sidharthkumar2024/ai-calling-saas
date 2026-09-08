'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronUp,
  Loader2,
  Send,
  RefreshCw,
  Search,
  MessageCircle,
} from 'lucide-react';

import { useT } from '@/components/locale-provider';
import {
  assignmentChange,
  type Assignment,
  type Conversation,
  type InboxMessage,
  type ReplyWindow,
} from '@/lib/whatsapp-inbox';
import {
  fillTemplate,
  placeholders,
  validateParams,
  type Template,
} from '@/lib/whatsapp-templates';

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
 *
 * The list carries the newest 200 messages across every conversation, so an
 * older one can arrive already truncated. "Older messages" reads further back
 * through the cursor endpoint, and what it fetches is kept aside from the
 * polled list — the 15-second refresh replaces the list, and merging the two
 * in one place would throw away everything a person had just scrolled back to.
 */

type Thread = Conversation & { window: ReplyWindow; assignment: Assignment };

type Agent = { id: string; name: string };

/** A conversation read back past the list's 200-message horizon. */
type Backfill = {
  messages: InboxMessage[];
  before: string | null;
  done: boolean;
};

export function CustomerWhatsAppInbox() {
  const t = useT();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [flows, setFlows] = useState<
    Array<{ id: string; name: string; cta_label: string }>
  >([]);
  const [templateId, setTemplateId] = useState('');
  const [params, setParams] = useState<string[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [backfill, setBackfill] = useState<Record<string, Backfill>>({});
  const [reading, setReading] = useState(false);
  const [pending, setPending] = useState<{
    phone: string;
    agentId: string;
    warning: string;
  } | null>(null);
  const [connected, setConnected] = useState(false);
  const [search, setSearch] = useState('');
  const controller = useRef<AbortController | null>(null);
  const [openPhone, setOpenPhone] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    try {
      const response = await fetch('/api/app/whatsapp-inbox', {
        cache: 'no-store',
        signal: current.signal,
      });
      const body = (await response.json()) as {
        conversations?: Thread[];
        agents?: Agent[];
        templates?: Template[];
        flows?: Array<{ id: string; name: string; cta_label: string }>;
        me?: string | null;
        connected?: boolean;
        error?: string;
      };
      if (!response.ok) {
        setNotice(body.error ?? 'Could not load the inbox.');
        return;
      }
      setThreads(body.conversations ?? []);
      setAgents(body.agents ?? []);
      setTemplates(body.templates ?? []);
      setFlows(body.flows ?? []);
      setMe(body.me ?? null);
      setConnected(body.connected === true);
    } catch {
      if (current.signal.aborted) return;
      setNotice('Could not load the inbox.');
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
      controller.current?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
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
          ? 'Accepted by Meta. Delivery confirmation may arrive later.'
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

  /**
   * Reads one page further back.
   *
   * The cursor is the oldest message on screen, not a page number: messages
   * keep arriving while somebody reads, and counting from the top would show
   * one twice or skip one.
   */
  async function readOlder(phone: string, oldestOnScreen: string) {
    const state = backfill[phone];
    const before = state ? state.before : oldestOnScreen;
    if (!before || state?.done) return;
    setReading(true);
    setNotice('');
    try {
      const response = await fetch(
        `/api/app/whatsapp-inbox?phone=${encodeURIComponent(phone)}&before=${encodeURIComponent(before)}`,
        { cache: 'no-store' },
      );
      const body = (await response.json()) as {
        messages?: InboxMessage[];
        cursor?: string | null;
        hasMore?: boolean;
        error?: string;
      };
      if (!response.ok) {
        setNotice(body.error ?? 'Could not read further back.');
        return;
      }
      const fetched = body.messages ?? [];
      setBackfill((current) => {
        const held = current[phone];
        return {
          ...current,
          [phone]: {
            messages: [...fetched, ...(held?.messages ?? [])],
            before: body.cursor ?? null,
            done: body.hasMore !== true,
          },
        };
      });
    } catch {
      setNotice('Could not read further back.');
    } finally {
      setReading(false);
    }
  }

  /**
   * Puts a name on a conversation.
   *
   * Taking one off a colleague is allowed — somebody goes to lunch mid-thread
   * and the customer should not wait — but it is a different act from picking
   * up an unclaimed one, so it asks first and says whose it was.
   */
  async function assign(phone: string, agentId: string) {
    setNotice('');
    setPending(null);
    try {
      const response = await fetch('/api/app/whatsapp-inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'assign',
          phone,
          supportAgentId: agentId || null,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setNotice(body.error ?? 'That assignment did not save.');
        return;
      }
      await load();
    } catch {
      setNotice('That assignment did not save.');
    }
  }

  /** Sends an approved template to a conversation whose window has closed. */
  async function sendTemplate(phone: string) {
    const template = templates.find((row) => row.id === templateId);
    if (!template) return;
    const problems = validateParams(template.body, params);
    if (problems.length) {
      setNotice(problems.join(' '));
      return;
    }
    setSending(true);
    setNotice('');
    try {
      const response = await fetch('/api/app/whatsapp-inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'send_template',
          phone,
          templateId,
          params,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setNotice(body.error ?? 'That template did not send.');
        return;
      }
      setNotice('Accepted by Meta. Delivery confirmation may arrive later.');
      setParams([]);
      setTemplateId('');
      await load();
    } catch {
      setNotice('That template did not send.');
    } finally {
      setSending(false);
    }
  }

  /**
   * Sends a form the customer fills in inside WhatsApp.
   *
   * Only inside the window — a form is an interactive message, not a template
   * — so this sits with the reply box rather than with the templates.
   */
  async function sendFlow(phone: string, flowId: string) {
    setSending(true);
    setNotice('');
    try {
      const response = await fetch('/api/app/whatsapp-inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'send_flow', phone, flowId }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setNotice(body.error ?? 'That form did not send.');
        return;
      }
      setNotice(
        'Form sent. The answers appear on the WhatsApp forms screen when they arrive.',
      );
      await load();
    } catch {
      setNotice('That form did not send.');
    } finally {
      setSending(false);
    }
  }

  function chooseAgent(thread: Thread, agentId: string) {
    const change = assignmentChange(
      thread.assignment ?? null,
      agentId || null,
      me ?? '',
    );
    if (change.kind === 'noop') return;
    if (change.warning) {
      setPending({ phone: thread.phone, agentId, warning: change.warning });
      return;
    }
    void assign(thread.phone, agentId);
  }

  if (loading)
    return (
      <div className="flex items-center gap-2 text-[11px] text-ink-muted">
        <Loader2 className="size-3.5 animate-spin" /> Loading the inbox…
      </div>
    );

  const open = threads.find((thread) => thread.phone === openPhone) ?? null;
  // The polled list and the pages read back are kept apart in state and joined
  // only here, so a refresh cannot discard what somebody scrolled back to.
  const earlier = (open && backfill[open.phone]) ?? {
    messages: [],
    before: null,
    done: false,
  };
  const transcript = open ? [...earlier.messages, ...open.messages] : [];
  const oldestOnScreen = transcript[0]?.created_at ?? null;
  const chosen =
    templates.find((template) => template.id === templateId) ?? null;
  const slots = chosen ? placeholders(chosen.body) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {t('screen.whatsapp_inbox.title')}
          </h1>
          <p className="mt-1 text-[11px] text-ink-muted">
            {t('screen.whatsapp_inbox.description')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-xl border border-hairline px-4 py-2 text-sm"
        >
          <RefreshCw className="size-4" /> Refresh inbox
        </button>
      </div>

      {!connected ? (
        <p className="rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-[11px] text-ink-body">
          Connect and verify your own WhatsApp number in Integrations & API.
          Replies stay disabled until that connection is ready.
        </p>
      ) : null}
      {notice ? (
        <output className="block rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-sm text-ink">
          {notice}
        </output>
      ) : null}

      <section className="portal-panel grid gap-4 p-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <label className="mb-4 flex items-center gap-2 rounded-xl border border-hairline p-3">
            <Search className="size-4 text-ink-muted" />
            <input
              aria-label="Search conversations"
              placeholder="Search number or message"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="min-w-0 w-full bg-transparent text-sm outline-none"
            />
          </label>
          {threads.length === 0 ? (
            <p className="text-[11px] text-ink-muted">
              Nothing yet. Messages appear here when a customer writes to your
              WhatsApp number.
            </p>
          ) : null}
          {threads
            .filter((thread) =>
              `${thread.phone} ${thread.preview}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((thread) => (
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
                  {thread.assignment?.agentName
                    ? ` · ${thread.assignment.agentName}`
                    : ''}
                </span>
              </button>
            ))}
        </div>

        <div className="min-w-0">
          {!open ? (
            <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl bg-emerald-50/60 p-6 text-center text-emerald-950">
              <MessageCircle className="size-10" />
              <h2 className="text-xl font-semibold">
                Your customer conversations, together.
              </h2>
              <p className="max-w-sm text-sm">
                Choose a conversation to reply. This inbox refreshes every 15
                seconds while visible. The latest 200 messages are shown.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-muted/50 px-3 py-2">
                <label
                  className="text-[11px] text-ink-muted"
                  htmlFor="whatsapp-assignee"
                >
                  Answering
                </label>
                <select
                  id="whatsapp-assignee"
                  value={open.assignment?.agentId ?? ''}
                  onChange={(event) => chooseAgent(open, event.target.value)}
                  className="rounded-lg border border-hairline bg-surface px-2 py-1 text-[11px]"
                >
                  <option value="">Nobody yet</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                      {agent.id === me ? ' (you)' : ''}
                    </option>
                  ))}
                </select>
                {agents.length === 0 ? (
                  <span className="text-[11px] text-ink-muted">
                    No support agents on this workspace yet.
                  </span>
                ) : null}
                {open.assignment?.assignedAt ? (
                  <span className="text-[11px] text-ink-muted">
                    since {open.assignment.assignedAt}
                  </span>
                ) : null}
              </div>
              {pending && pending.phone === open.phone ? (
                <div className="mb-3 rounded-xl border border-warning-text/30 bg-warning-text/[0.05] px-3 py-2 text-[11px] text-warning-text">
                  <p>{pending.warning}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void assign(pending.phone, pending.agentId)
                      }
                      className="portal-primary rounded-lg px-3 py-1.5 text-[11px]"
                    >
                      Take it over
                    </button>
                    <button
                      type="button"
                      onClick={() => setPending(null)}
                      className="rounded-lg border border-hairline px-3 py-1.5 text-[11px]"
                    >
                      Leave it
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="max-h-[26rem] space-y-2 overflow-y-auto rounded-xl border border-hairline bg-surface-muted/50 p-3">
                {earlier.done ? (
                  <p className="pb-1 text-center text-[11px] text-ink-muted">
                    The beginning of this conversation.
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={reading || !oldestOnScreen}
                    onClick={() =>
                      void readOlder(open.phone, oldestOnScreen ?? '')
                    }
                    className="mx-auto flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-[11px] disabled:opacity-40"
                  >
                    {reading ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ChevronUp className="size-3.5" />
                    )}
                    Older messages
                  </button>
                )}
                {transcript.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-[12px] leading-5 ${
                      message.direction === 'inbound'
                        ? 'bg-surface'
                        : 'ml-auto bg-primary text-primary-foreground'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words text-sm">
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
                    maxLength={4000}
                    disabled={!connected || sending}
                    value={draft}
                    rows={2}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Reply…"
                    aria-label={`Reply to ${open.phone}`}
                    className="flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[12px] outline-none"
                  />
                  <button
                    type="button"
                    disabled={!connected || !draft.trim() || sending}
                    onClick={() => void reply(open.phone)}
                    aria-label="Send reply"
                    className="portal-primary rounded-lg px-3 py-2 text-[11px] disabled:opacity-40"
                  >
                    <Send className="size-3.5" />
                  </button>
                </div>
              ) : null}
              {open.window.open && flows.length ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label
                    className="text-[11px] text-ink-muted"
                    htmlFor="whatsapp-flow"
                  >
                    Or send a form
                  </label>
                  <select
                    id="whatsapp-flow"
                    value=""
                    disabled={!connected || sending}
                    onChange={(event) => {
                      if (event.target.value)
                        void sendFlow(open.phone, event.target.value);
                    }}
                    className="rounded-lg border border-hairline bg-surface px-2 py-1 text-[11px] disabled:opacity-40"
                  >
                    <option value="">Choose a form…</option>
                    {flows.map((flow) => (
                      <option key={flow.id} value={flow.id}>
                        {flow.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-hairline bg-surface-muted px-3 py-2.5">
                  <p className="text-[11px] text-ink-body">
                    {open.window.reason}
                  </p>
                  {/* The window closing is not the end of the conversation —
                      an approved template is what WhatsApp accepts instead,
                      and this is where a person reaches one. */}
                  {templates.length === 0 ? (
                    <p className="mt-2 text-[11px] text-ink-muted">
                      No approved template to send. Write one on the WhatsApp
                      templates screen and submit it to Meta for review.
                    </p>
                  ) : (
                    <div className="mt-2.5 space-y-2">
                      <label
                        className="block text-[11px] text-ink-muted"
                        htmlFor="whatsapp-template"
                      >
                        Send an approved template instead
                      </label>
                      <select
                        id="whatsapp-template"
                        value={templateId}
                        onChange={(event) => {
                          setTemplateId(event.target.value);
                          setParams([]);
                        }}
                        className="w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[11px]"
                      >
                        <option value="">Choose a template…</option>
                        {templates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name} · {template.language}
                          </option>
                        ))}
                      </select>
                      {chosen ? (
                        <>
                          {slots.map((slot) => (
                            <input
                              key={slot}
                              value={params[slot - 1] ?? ''}
                              maxLength={200}
                              placeholder={`Variable {{${slot}}}`}
                              aria-label={`Variable ${slot}`}
                              onChange={(event) =>
                                setParams((current) => {
                                  const next = [...current];
                                  next[slot - 1] = event.target.value;
                                  return next;
                                })
                              }
                              className="w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[11px]"
                            />
                          ))}
                          {/* Filled in, exactly as the customer will read it.
                              An unfilled slot stays visible as {{2}} rather
                              than disappearing into a gap in a sentence. */}
                          <p className="whitespace-pre-wrap rounded-lg border border-hairline bg-surface px-2.5 py-2 text-[12px] text-ink">
                            {fillTemplate(chosen.body, params)}
                          </p>
                          <button
                            type="button"
                            disabled={!connected || sending}
                            onClick={() => void sendTemplate(open.phone)}
                            className="portal-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] disabled:opacity-40"
                          >
                            {sending ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Send className="size-3.5" />
                            )}
                            Send template
                          </button>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
