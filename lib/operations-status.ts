/**
 * Turning an alert rule or a graph agent off.
 *
 * The last two the table-usage audit found. Both are created through the
 * operations screen, both carry a `status`, and nothing has ever updated
 * either — so an alert rule could not be silenced once it started firing, and
 * a graph agent was born `draft` and stayed `draft` for good, which is to say
 * it could be built and never used.
 *
 * As with the org configuration, the reader was already correct:
 * `lib/job-queue.ts` evaluates only rules whose status is `active`. It was
 * waiting for a writer.
 */

export const ALERT_RULE_STATUSES = ['active', 'disabled'] as const;
export type AlertRuleStatus = (typeof ALERT_RULE_STATUSES)[number];

export function isAlertRuleStatus(value: unknown): value is AlertRuleStatus {
  return (ALERT_RULE_STATUSES as readonly string[]).includes(String(value));
}

/** Anything unrecognised counts as active, so a rule never goes quiet by accident. */
export function normaliseAlertStatus(value: unknown): AlertRuleStatus {
  return String(value) === 'disabled' ? 'disabled' : 'active';
}

export function toggleAlertStatus(current: unknown): AlertRuleStatus {
  return normaliseAlertStatus(current) === 'active' ? 'disabled' : 'active';
}

/**
 * A graph agent's life.
 *
 * `draft` is where it starts and where it went to die. `published` is the only
 * state it can answer calls in, `paused` takes it out without losing it, and
 * `archived` is terminal — a graph somebody built and no longer wants, kept
 * because runs recorded against it should still name something.
 */
export const GRAPH_AGENT_STATUSES = [
  'draft',
  'published',
  'paused',
  'archived',
] as const;

export type GraphAgentStatus = (typeof GRAPH_AGENT_STATUSES)[number];

export function isGraphAgentStatus(value: unknown): value is GraphAgentStatus {
  return (GRAPH_AGENT_STATUSES as readonly string[]).includes(String(value));
}

export function nextGraphStatuses(current: string): GraphAgentStatus[] {
  switch (current) {
    case 'published':
      return ['paused', 'archived'];
    case 'archived':
      // Terminal. A graph worth using again is worth copying, so the record of
      // what was live when a call happened stays true.
      return [];
    default:
      // `draft`, and anything else. A row seeded before these states existed
      // holds 'active', and a status nobody recognises must not leave the row
      // with no moves at all — unmanageable is worse than mislabelled.
      return ['published', 'archived'];
  }
}

export function canMoveGraph(from: string, to: string) {
  return nextGraphStatuses(from).includes(to as GraphAgentStatus);
}

export const GRAPH_ACTION_LABEL: Record<GraphAgentStatus, string> = {
  draft: 'Back to draft',
  published: 'Publish',
  paused: 'Pause',
  archived: 'Archive',
};
