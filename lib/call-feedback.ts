export type ActivityItem = { id: string; status: string; channel?: string };
export type ActivitySnapshot = {
  calls: ActivityItem[];
  handoffs: ActivityItem[];
};
export function activityChanges(
  previous: ActivitySnapshot | null,
  current: ActivitySnapshot,
) {
  const events: Array<{
    event:
      | 'ringing'
      | 'call_connected'
      | 'handoff_requested'
      | 'transfer_accepted';
    subject: string;
    detail: string;
  }> = [];
  if (!previous) return events;
  const oldCalls = new Map(previous.calls.map((row) => [row.id, row.status]));
  const oldHandoffs = new Map(
    previous.handoffs.map((row) => [row.id, row.status]),
  );
  for (const call of current.calls) {
    if (call.channel !== 'phone' || oldCalls.get(call.id) === call.status)
      continue;
    if (call.status === 'ringing')
      events.push({
        event: 'ringing',
        subject: call.id,
        detail: 'A phone call is ringing.',
      });
    if (
      ['connected', 'in_progress'].includes(call.status) &&
      !['connected', 'in_progress'].includes(oldCalls.get(call.id) ?? '')
    )
      events.push({
        event: 'call_connected',
        subject: call.id,
        detail: 'A phone conversation is in progress.',
      });
  }
  for (const handoff of current.handoffs) {
    const before = oldHandoffs.get(handoff.id);
    if (
      ['queued', 'assigned'].includes(handoff.status) &&
      !['queued', 'assigned', 'accepted'].includes(before ?? '')
    )
      events.push({
        event: 'handoff_requested',
        subject: handoff.id,
        detail: 'A caller needs a team member. Open Agent Desk to review.',
      });
    if (handoff.status === 'accepted' && before !== 'accepted')
      events.push({
        event: 'transfer_accepted',
        subject: handoff.id,
        detail: 'A team member accepted the handoff.',
      });
  }
  return events;
}
