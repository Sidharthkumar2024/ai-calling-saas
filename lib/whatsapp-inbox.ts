/**
 * Turning a list of WhatsApp messages into conversations, and knowing when a
 * reply is still allowed.
 *
 * The second half is the part that matters. WhatsApp lets a business send a
 * free-form message only within 24 hours of the customer's last message; after
 * that only an approved template goes through, and a plain send comes back as a
 * Meta error the person who typed it never sees the meaning of. So the window
 * is computed here, before anyone is offered a text box, and the reason is said
 * in words rather than discovered as a failure.
 *
 * Pure — no database, no fetch — so the grouping and the window arithmetic are
 * tested directly.
 */

export type InboxMessage = {
  id: string;
  sender_phone: string;
  direction: string;
  message_type: string;
  body: string | null;
  media_id: string | null;
  created_at: string;
};

export type Conversation = {
  phone: string;
  messages: InboxMessage[];
  /** The most recent message either way, for ordering the list. */
  lastAt: string;
  /** The most recent message *from the customer*, which starts the window. */
  lastInboundAt: string | null;
  preview: string;
  inboundCount: number;
};

/** The 24 hours WhatsApp gives a business to answer in its own words. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

function when(value: string): number {
  // SQLite writes "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker; parsed as
  // local time that is hours out, which would open or close the window
  // wrongly depending on where the reader is.
  const normalised = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const parsed = Date.parse(normalised);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** One line for the list: what was said, or what kind of thing arrived. */
export function previewOf(message: InboxMessage): string {
  const body = (message.body ?? '').trim();
  if (body) return body.length > 90 ? `${body.slice(0, 89)}…` : body;
  if (message.media_id) return `[${message.message_type || 'attachment'}]`;
  return `[${message.message_type || 'message'}]`;
}

/**
 * Groups messages by the customer's number, newest conversation first.
 *
 * Rows arrive newest-first from the query; each conversation's own messages are
 * put back in the order they were said, because a thread read backwards is not
 * a thread.
 */
export function toConversations(messages: InboxMessage[]): Conversation[] {
  const byPhone = new Map<string, InboxMessage[]>();
  for (const message of messages) {
    const phone = String(message.sender_phone ?? '').trim() || 'unknown';
    const thread = byPhone.get(phone) ?? [];
    thread.push(message);
    byPhone.set(phone, thread);
  }

  const conversations: Conversation[] = [];
  for (const [phone, thread] of byPhone) {
    const ordered = [...thread].sort(
      (a, b) => when(a.created_at) - when(b.created_at),
    );
    const inbound = ordered.filter(
      (message) => message.direction === 'inbound',
    );
    const last = ordered[ordered.length - 1];
    conversations.push({
      phone,
      messages: ordered,
      lastAt: last?.created_at ?? '',
      lastInboundAt: inbound[inbound.length - 1]?.created_at ?? null,
      preview: last ? previewOf(last) : '',
      inboundCount: inbound.length,
    });
  }
  return conversations.sort((a, b) => when(b.lastAt) - when(a.lastAt));
}

export type ReplyWindow = {
  open: boolean;
  /** Whole hours left, for the line above the box. */
  hoursLeft: number;
  reason: string;
};

/**
 * Whether a free-form reply would actually be delivered.
 *
 * `now` is a parameter rather than read from the clock so the boundary can be
 * tested at exactly 24 hours rather than near it.
 */
export function replyWindow(
  conversation: Pick<Conversation, 'lastInboundAt'>,
  now: number = Date.now(),
): ReplyWindow {
  if (!conversation.lastInboundAt)
    return {
      open: false,
      hoursLeft: 0,
      reason:
        'This customer has not messaged you, so WhatsApp will only accept an approved template here.',
    };
  const elapsed = now - when(conversation.lastInboundAt);
  if (!when(conversation.lastInboundAt) || elapsed < 0 || !Number.isFinite(now))
    return {
      open: false,
      hoursLeft: 0,
      reason:
        'The last customer-message timestamp is invalid. Refresh before replying.',
    };
  if (elapsed >= REPLY_WINDOW_MS)
    return {
      open: false,
      hoursLeft: 0,
      reason:
        'More than 24 hours since their last message. WhatsApp only accepts an approved template now, not a typed reply.',
    };
  const hoursLeft = Math.max(
    1,
    Math.floor((REPLY_WINDOW_MS - elapsed) / (60 * 60 * 1000)),
  );
  return {
    open: true,
    hoursLeft,
    reason: `${hoursLeft} ${hoursLeft === 1 ? 'hour' : 'hours'} left to reply in your own words.`,
  };
}

/* ------------------------------------------------------------------ *
 * Reading further back
 *
 * The inbox loads the most recent messages and stops. For a busy number that
 * means older conversations simply are not there — and worse, a conversation
 * whose recent messages are all outbound looks like it began with the
 * business talking, because the customer's opening line fell off the end.
 *
 * A cursor is the created_at of the oldest message already shown. It is not an
 * offset: rows arrive while someone reads, and an offset would show them a
 * message twice or skip one entirely.
 * ------------------------------------------------------------------ */

/** How many messages one page carries. */
export const PAGE_SIZE = 50;

export type Page = {
  messages: InboxMessage[];
  /** Pass back to read further; null when the beginning has been reached. */
  cursor: string | null;
  hasMore: boolean;
};

/**
 * Turns a fetched batch into a page.
 *
 * The query asks for one more row than a page holds, which is how "is there
 * more" is answered without a second count that could disagree with the rows
 * just read.
 */
export function toPage(rows: InboxMessage[], pageSize = PAGE_SIZE): Page {
  const hasMore = rows.length > pageSize;
  const messages = hasMore ? rows.slice(0, pageSize) : rows;
  const oldest = messages[messages.length - 1];
  return {
    messages,
    cursor: hasMore && oldest ? oldest.created_at : null,
    hasMore,
  };
}

/* ------------------------------------------------------------------ *
 * Who is answering
 * ------------------------------------------------------------------ */

export type Assignment = {
  phone: string;
  agentId: string | null;
  agentName: string | null;
  assignedAt: string | null;
};

/**
 * Whether this person may take a conversation someone else is already on.
 *
 * Taking it is allowed — a colleague goes to lunch mid-conversation and the
 * customer should not wait — but it is a different act from picking up an
 * unassigned one, and the screen says so rather than silently reassigning.
 */
export function assignmentChange(
  current: Assignment | null,
  nextAgentId: string | null,
  actingAgentId: string,
): { kind: 'claim' | 'release' | 'takeover' | 'noop'; warning?: string } {
  const held = current?.agentId ?? null;
  if (nextAgentId === null)
    return held ? { kind: 'release' } : { kind: 'noop' };
  if (held === nextAgentId) return { kind: 'noop' };
  if (!held) return { kind: 'claim' };
  return {
    kind: 'takeover',
    warning:
      held === actingAgentId
        ? undefined
        : 'Someone else is on this conversation. Taking it over moves it to you.',
  };
}
