/**
 * Paid onboarding (§3).
 *
 * §3 is explicit: **no free production plan.** A workspace signs up, gets a
 * playground, and cannot place a real call until it has chosen a plan, given
 * its business details, paid, and set up an agent.
 *
 * The important design decision is that a step is **derived from evidence, not
 * stored as a flag**. `onboarding_profiles.stage` already existed and was
 * inert — written once at signup and never advanced, because advancing it was
 * somebody's job and nobody's code. A stage computed from "is there a paid
 * invoice, is there a GSTIN, is there a published agent" cannot fall out of
 * step with reality, and cannot be skipped by writing to a column.
 *
 * Pure: the caller gathers the facts, this decides what they mean.
 */

export type OnboardingFacts = {
  /** A plan has been chosen (a subscription row exists). */
  planSelected: boolean;
  /** Legal name and tax identity, where the country needs one. */
  businessDetails: boolean;
  /** At least one KYC document uploaded. */
  documents: boolean;
  /** A paid invoice exists. This is the gate §3 cares about. */
  paid: boolean;
  /** Any integration connected — telephony, messaging, payments. */
  integrations: boolean;
  /** Any knowledge source ingested. */
  knowledge: boolean;
  /** An agent exists and is not a draft. */
  agentReady: boolean;
  /** The agent has been exercised in the playground at least once. */
  playgroundTested: boolean;
};

export type OnboardingStep = {
  id: string;
  label: string;
  description: string;
  /** A workspace cannot go live until every required step is done. */
  required: boolean;
  done: boolean;
};

/**
 * The wizard, in §3's order.
 *
 * `integrations` and `knowledge` are deliberately **not required**: a workspace
 * that connects its own carrier later, or sells something simple enough to need
 * no knowledge base, should not be blocked from going live. Marking every step
 * required would make the gate look thorough and make the product unusable.
 */
export function onboardingSteps(facts: OnboardingFacts): OnboardingStep[] {
  return [
    {
      id: 'plan',
      label: 'Choose a plan',
      description: 'Capacity, agents and included credits.',
      required: true,
      done: facts.planSelected,
    },
    {
      id: 'business',
      label: 'Business details',
      description: 'Legal name and tax identity, so invoices are correct.',
      required: true,
      done: facts.businessDetails,
    },
    {
      id: 'documents',
      label: 'Documents',
      description: 'Business registration and calling-purpose evidence.',
      required: false,
      done: facts.documents,
    },
    {
      id: 'payment',
      label: 'Payment',
      description: 'A paid invoice. §3: no free production plan.',
      required: true,
      done: facts.paid,
    },
    {
      id: 'integrations',
      label: 'Integrations',
      description: 'Telephony, messaging and payment providers.',
      required: false,
      done: facts.integrations,
    },
    {
      id: 'knowledge',
      label: 'Knowledge',
      description: 'What the agent may answer from.',
      required: false,
      done: facts.knowledge,
    },
    {
      id: 'agent',
      label: 'AI agent',
      description: 'A published agent with a voice and a goal.',
      required: true,
      done: facts.agentReady,
    },
    {
      id: 'playground',
      label: 'Playground',
      description: 'Hear the agent before a customer does.',
      required: true,
      done: facts.playgroundTested,
    },
  ];
}

export type OnboardingState = {
  steps: OnboardingStep[];
  /** The first step still to do, or null when everything required is done. */
  nextStep: OnboardingStep | null;
  completed: number;
  total: number;
  percent: number;
  live: boolean;
  /** Why the workspace cannot go live, in the customer's words. */
  blockers: string[];
};

export function onboardingState(facts: OnboardingFacts): OnboardingState {
  const steps = onboardingSteps(facts);
  const required = steps.filter((step) => step.required);
  const blockers = required
    .filter((step) => !step.done)
    .map((step) => step.label);
  const completed = steps.filter((step) => step.done).length;
  return {
    steps,
    // The next thing to do is the first *incomplete* step in order, whether or
    // not it is required — an optional step still deserves a prompt.
    nextStep: steps.find((step) => !step.done) ?? null,
    completed,
    total: steps.length,
    percent: Math.round((completed / steps.length) * 100),
    live: blockers.length === 0,
    blockers,
  };
}

export type LiveGate =
  | { allowed: true }
  | { allowed: false; reason: string; blockers: string[] };

/**
 * Whether this workspace may place a real call.
 *
 * The playground is deliberately outside this gate: §3 gives a new workspace a
 * playground precisely so it can hear the agent before paying. What is gated is
 * dialling a real person.
 */
export function liveCallGate(state: OnboardingState): LiveGate {
  if (state.live) return { allowed: true };
  return {
    allowed: false,
    reason: `Finish setup before placing real calls: ${state.blockers.join(', ')}.`,
    blockers: state.blockers,
  };
}
