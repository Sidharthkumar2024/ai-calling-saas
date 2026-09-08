/**
 * When a workflow may answer a WhatsApp message, and the shape of a number.
 *
 * Kept apart from the dispatcher because these are the rules worth being sure
 * of — every one of them is a way for a bot to do something rude — and because
 * a module with no database can be tested directly.
 */

export type InboundMessage = {
  messageType: string;
  body: string | null;
  /** False when the row already existed, i.e. Meta sent this one again. */
  isNew: boolean;
  /** The support agent holding this conversation, if anybody is. */
  assignedAgentId: string | null;
};

export type BotSkip =
  | 'duplicate'
  | 'not_text'
  | 'empty'
  | 'human_assigned'
  | 'no_workflow';

/**
 * Whether a graph should touch this message at all.
 *
 * Order matters. A retried webhook is a duplicate whatever else is true of it,
 * and a conversation a colleague has claimed is theirs whatever arrives in it.
 */
export function botSkipReason(message: InboundMessage): BotSkip | null {
  if (!message.isNew) return 'duplicate';
  if (message.assignedAgentId) return 'human_assigned';
  if (message.messageType !== 'text') return 'not_text';
  if (!(message.body ?? '').trim()) return 'empty';
  return null;
}

/**
 * A phone number in the one shape every lookup here agrees on.
 *
 * A parked run is found by its number, so "+91 98123 45678" and
 * "919812345678" have to reduce to the same key or a customer's reply wakes
 * nothing and the conversation simply stops.
 */
export function normalisePhone(value: string): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}
