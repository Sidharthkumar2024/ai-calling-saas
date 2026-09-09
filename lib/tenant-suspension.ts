/**
 * What a suspension actually stopped, and what a reactivation did not start.
 *
 * "Suspended" on its own hides the part with consequences: a running campaign
 * is dialling real people, and suspending the workspace stops it mid-flight.
 * Switching the workspace back on does not start it again — nothing does but a
 * person — so a reactivated tenant with paused campaigns makes no calls and
 * looks exactly like one that is working. That was invisible from the admin
 * screen, which reported only that the status had changed.
 */

/**
 * Counts arrive from a JSON body, so a missing one is 0 and a nonsense one is
 * not printed at somebody as NaN.
 */
function count(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

/**
 * Takes numbers, not the response body: the shape of the wire belongs to the
 * screen that reads it, and the audit that looks for answers no screen reads
 * would be satisfied by a field name buried in here.
 */
export function suspensionNote(input: {
  campaignsPaused: unknown;
  jobsCancelled: unknown;
}): string {
  const campaigns = count(input.campaignsPaused);
  const jobs = count(input.jobsCancelled);
  const stopped = [
    campaigns > 0
      ? `${campaigns} running campaign${campaigns === 1 ? '' : 's'}`
      : '',
    jobs > 0 ? `${jobs} queued job${jobs === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  // "Nothing was running" is worth saying. A suspension that stopped nothing
  // and one that stopped a live campaign are different acts, and a bare
  // "Suspended." reads the same either way.
  return stopped.length
    ? `Suspended. Stopped ${stopped.join(' and ')}.`
    : 'Suspended. Nothing was running.';
}

export function reactivationNote(input: { campaignsPaused: unknown }): string {
  const paused = count(input.campaignsPaused);
  if (paused === 0) return 'Back on. No campaigns are waiting to be started.';
  // Not "still paused" — that would claim this suspension paused them, and the
  // count is every paused campaign in the workspace, including ones the
  // customer stopped themselves last month. What is true of all of them is
  // that nothing will start them.
  return paused === 1
    ? 'Back on. 1 campaign is paused and will not start on its own — somebody in the workspace has to start it.'
    : `Back on. ${paused} campaigns are paused and will not start on their own — somebody in the workspace has to start them.`;
}
