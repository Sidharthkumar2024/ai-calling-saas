/**
 * Turning a recommendation into work (§6, "Execution").
 *
 * §6's last row asks that a recommendation become "a campaign, workflow,
 * content/task or human assignment". The easy version of this is a button on
 * every card that creates a to-do titled after the recommendation, which is
 * decoration: it moves a sentence from one screen to another and calls it
 * execution.
 *
 * So the rule here matches the rest of the growth manager:
 *
 *   **An offer must name exactly what it will do, in the workspace's own
 *   numbers, and must be refused in words when the workspace cannot do it.**
 *
 * "Create a campaign from the 12 leads scoring 75 and above" is an offer.
 * "Take action" is not. And when there are no such leads, or no agent
 * configured to call them, the offer is not quietly hidden — it is shown
 * greyed out with the reason, because "why can't I do this?" is the question
 * a hidden button never answers.
 *
 * Pure: which offers exist for which recommendation, and what blocks them.
 */

export type ExecutionKind = 'campaign' | 'task' | 'workflow';

export type ExecutionOffer = {
  /** Stable per recommendation and kind, so a repeat click is recognisable. */
  id: string;
  recommendationId: string;
  kind: ExecutionKind;
  label: string;
  /** Exactly what happens if this is used. Numbers, not adjectives. */
  effect: string;
  /** Null when it can be done; the reason in plain words when it cannot. */
  blockedBy: string | null;
};

/**
 * What the workspace can currently support. Every field is measured, so an
 * offer is never blocked on a guess.
 */
export type ExecutionContext = {
  /** Leads at or above the hot threshold that have a phone number. */
  hotLeadCount: number;
  /** How many of those the workspace actually has consent to call. */
  hotLeadsWithConsent: number;
  hotLeadThreshold: number;
  /** Agents that could place the calls. */
  agentCount: number;
  /** The objection the recommendation is about, in the caller's own words. */
  topObjection: string | null;
  /** Calls behind the sentiment observation. */
  negativeCallCount: number;
  /** People who could be assigned the work. */
  assignableCount: number;
};

export const HOT_LEAD_THRESHOLD = 75;

/**
 * The offers for one recommendation.
 *
 * Deliberately not "every recommendation gets every kind". A campaign is only
 * offered where the evidence behind the recommendation is a concrete set of
 * rows that can be dialled — otherwise "create a campaign" would mean
 * "create an empty campaign", which is worse than no button.
 */
export function offersFor(
  recommendation: { id: string; title: string },
  context: ExecutionContext,
): ExecutionOffer[] {
  const offers: ExecutionOffer[] = [];
  const make = (
    kind: ExecutionKind,
    label: string,
    effect: string,
    blockedBy: string | null,
  ) =>
    offers.push({
      id: `${recommendation.id}:${kind}`,
      recommendationId: recommendation.id,
      kind,
      label,
      effect,
      blockedBy,
    });

  if (recommendation.id === 'work_hot_leads') {
    // The consent count is in the offer, not in the result. Finding out
    // afterwards that none of the leads can legally be called is finding out
    // too late — the dialer would simply skip every one of them.
    const consentNote =
      context.hotLeadsWithConsent === 0
        ? ' None of them has consent on record yet, so the dialer will skip them until that is fixed.'
        : context.hotLeadsWithConsent < context.hotLeadCount
          ? ` ${context.hotLeadsWithConsent} of them has consent on record; the rest will be skipped until that is fixed.`
          : '';
    make(
      'campaign',
      'Create the campaign',
      `Creates a draft campaign holding the ${context.hotLeadCount} lead${
        context.hotLeadCount === 1 ? '' : 's'
      } scoring ${context.hotLeadThreshold} or above. It does not start dialling — you review it and press start.${consentNote}`,
      context.hotLeadCount === 0
        ? `No lead is scoring ${context.hotLeadThreshold} or above right now, so the campaign would be empty.`
        : context.agentCount === 0
          ? 'No agent is configured to make the calls yet.'
          : null,
    );
    make(
      'workflow',
      'Install the sales workflow',
      'Installs the sales qualification workflow as a draft — qualify, score, pitch, handle the objection, then book, charge or hand over.',
      null,
    );
  }

  if (recommendation.id === 'lift_conversion')
    make(
      'workflow',
      'Install the sales workflow',
      'Installs the sales qualification workflow as a draft, so the opening and the qualification questions are the same on every call instead of improvised.',
      null,
    );

  if (recommendation.id === 'answer_objection')
    make(
      'task',
      'Assign it',
      context.topObjection
        ? `Creates a task to write the approved answer to “${context.topObjection}”, which reaches live calls as soon as it is saved.`
        : 'Creates a task to write the approved answer to your most common objection.',
      null,
    );

  if (recommendation.id === 'sentiment_review')
    make(
      'task',
      'Assign the review',
      `Creates a task to listen to the ${context.negativeCallCount} call${
        context.negativeCallCount === 1 ? '' : 's'
      } behind this and check what the agent was answering from.`,
      context.negativeCallCount === 0
        ? 'The calls behind this observation are no longer in the window it measured.'
        : null,
    );

  // Every recommendation can be given to a person. Added last so the specific
  // offers come first, and skipped where one is already a task.
  if (!offers.some((offer) => offer.kind === 'task'))
    make(
      'task',
      'Assign it',
      `Creates a task titled “${recommendation.title}” with the evidence attached, so whoever picks it up sees the numbers it came from.`,
      context.assignableCount === 0
        ? 'There is nobody in this workspace to assign it to yet.'
        : null,
    );

  return offers;
}

export const EXECUTION_STATUSES = ['open', 'done', 'dropped'] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export type ExecutedAction = {
  id: string;
  recommendationId: string;
  kind: ExecutionKind;
  title: string;
  detail: string;
  status: ExecutionStatus;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
  completedAt: string | null;
};

/**
 * What the board says under a recommendation that has already been acted on.
 *
 * The point is that acting on advice does not make the advice disappear: the
 * observation behind it is still true until the numbers move. So the card
 * stays, and this line says what was done and when.
 */
export function actionSummary(action: ExecutedAction): string {
  const verb =
    action.kind === 'campaign'
      ? 'Campaign created'
      : action.kind === 'workflow'
        ? 'Workflow installed'
        : 'Task created';
  if (action.status === 'done') return `${verb} and marked done.`;
  if (action.status === 'dropped') return `${verb}, then dropped.`;
  return `${verb}. Still open.`;
}

/** Offers already acted on, so a second click is a repeat rather than a surprise. */
export function alreadyDone(
  offers: ExecutionOffer[],
  actions: ExecutedAction[],
): Set<string> {
  const live = new Set(
    actions
      .filter((action) => action.status !== 'dropped')
      .map((action) => `${action.recommendationId}:${action.kind}`),
  );
  return new Set(
    offers.filter((offer) => live.has(offer.id)).map((offer) => offer.id),
  );
}
