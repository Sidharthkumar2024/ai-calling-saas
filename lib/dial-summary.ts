/**
 * Saying what a campaign pass actually did.
 *
 * The dialer records exactly why every contact was attempted or skipped, and
 * a pass runs the moment somebody presses "Start calling" so that starting a
 * campaign does something observable. The answer was then thrown away by the
 * screen, which called the endpoint, ignored the body and refreshed the list.
 *
 * So a workspace with no phone number connected pressed Start, watched the
 * campaign turn "running", and waited. Nothing was dialled and nothing said
 * why — while the reason had been computed, returned over the wire, and
 * dropped one function short of the person who could fix it.
 *
 * Pure — no database, no fetch.
 */

export type DialSummary = {
  campaignId?: string;
  status?: string;
  considered?: number;
  attempted?: number;
  skipped?: Record<string, number>;
  requeued?: boolean;
  reason?: string;
};

/** Each contact-level skip, in words, and what to do about it. */
const SKIP_LABEL: Record<string, string> = {
  suppressed: 'on the do-not-contact list',
  no_consent: 'without recorded consent to be called',
  max_attempts: 'already tried the maximum number of times',
  telephony_unconfigured: 'blocked because no calling connection is live',
  // Not a property of the contact. Naming it as one would be another way of
  // implying the product tried and something about that person stopped it.
  origination_not_wired:
    'not called, because campaigns cannot place calls in this build',
};

/** A whole pass that could not start, and the reason it could not. */
const REASON_LABEL: Record<string, string> = {
  campaign_not_found: 'That campaign no longer exists.',
  campaign_not_running: 'The campaign is not running, so nothing was dialled.',
  outside_calling_window:
    'It is outside this campaign’s calling window. It will start dialling when the window opens.',
  concurrency_saturated:
    'Every call slot is already in use. It will pick up as calls finish.',
  insufficient_credits:
    'The wallet is below 10 credits, so the campaign was paused. Top up and start it again.',
};

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * One sentence about the pass that just ran.
 *
 * Never "started successfully" on its own. Starting is the easy half; whether
 * anybody was called is the half somebody is waiting to learn, and the
 * difference between "0 dialled because everyone is on the do-not-contact
 * list" and "0 dialled because no number is connected" is the difference
 * between two completely different afternoons.
 */
export function describeDialPass(
  summary: DialSummary | null | undefined,
): string {
  if (!summary) return 'Campaign started.';
  const attempted = Number(summary.attempted ?? 0);
  const considered = Number(summary.considered ?? 0);
  const reason = String(summary.reason ?? '');

  // Onboarding carries its own list of blockers, so it is named rather than
  // flattened into "something is not set up".
  if (reason.startsWith('onboarding_incomplete')) {
    const blockers = reason.split(':')[1]?.split('|').filter(Boolean) ?? [];
    const named = blockers.map((item) => item.replaceAll('_', ' ')).join(', ');
    return `Nothing was dialled: this workspace cannot place live calls yet${
      named ? ` — ${named}` : ''
    }. The campaign will start on its own once that is done.`;
  }
  if (REASON_LABEL[reason]) return REASON_LABEL[reason];

  const skipped = summary.skipped ?? {};
  const skips = Object.entries(skipped)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  const skippedTotal = skips.reduce((sum, [, count]) => sum + Number(count), 0);

  if (attempted > 0) {
    const tail = skippedTotal
      ? ` ${plural(skippedTotal, 'contact')} were skipped: ${skips
          .map(
            ([key, count]) =>
              `${count} ${SKIP_LABEL[key] ?? key.replaceAll('_', ' ')}`,
          )
          .join(', ')}.`
      : '';
    return `Calling ${plural(attempted, 'contact')}.${tail}`;
  }

  if (skippedTotal > 0)
    return `Nothing was dialled. ${plural(skippedTotal, 'contact')} were skipped: ${skips
      .map(
        ([key, count]) =>
          `${count} ${SKIP_LABEL[key] ?? key.replaceAll('_', ' ')}`,
      )
      .join(', ')}.`;

  if (considered === 0)
    return 'The campaign is running, but it has no contacts waiting to be called.';

  return 'The campaign is running. Nothing was dialled on this pass.';
}

/** Whether that sentence is bad news, so the screen can show it as such. */
export function dialPassNeedsAttention(
  summary: DialSummary | null | undefined,
): boolean {
  if (!summary) return false;
  if (Number(summary.attempted ?? 0) > 0) return false;
  const reason = String(summary.reason ?? '');
  // Waiting for a window or a free slot is the campaign working, not failing.
  if (reason === 'outside_calling_window' || reason === 'concurrency_saturated')
    return false;
  return true;
}
