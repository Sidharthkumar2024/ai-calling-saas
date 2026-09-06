/**
 * The agent lifecycle (Part 2.1).
 *
 * An agent had two states, `draft` and `active`, and editing one overwrote it
 * in place. There was no way to try a change without risking the agent
 * answering calls, no way back to what it said yesterday, and no record that
 * anything had changed at all. For a configuration that decides what a
 * business says to its customers, that is the wrong shape.
 *
 * `active` is kept as the published state rather than renamed. Every query in
 * the codebase that decides whether an agent may take a call filters on
 * `status = 'active'`, and renaming it would mean changing all of them
 * correctly at once — a rename that misses one is an agent that keeps
 * answering after it was archived.
 *
 * Two rules carry the weight:
 *
 * **Publishing is earned, not clicked.** An agent missing a prompt or a voice
 * cannot go live, and the screen says which piece is missing rather than
 * greying out a button.
 *
 * **A rollback says what it will change before it does it.** Restoring version
 * three is not "undo" — it is a new edit that happens to match an old one, and
 * anybody about to do it to a live agent should see which fields move.
 *
 * Pure: states, transitions, readiness, versioning and the diff.
 */

export const AGENT_STATES = [
  'draft',
  'testing',
  'ready',
  'active',
  'paused',
  'archived',
] as const;
export type AgentState = (typeof AGENT_STATES)[number];

export function isAgentState(value: unknown): value is AgentState {
  return (
    typeof value === 'string' &&
    (AGENT_STATES as readonly string[]).includes(value)
  );
}

/** What each state is called where a person reads it. */
export const STATE_LABEL: Record<AgentState, string> = {
  draft: 'Draft',
  testing: 'Testing',
  ready: 'Ready to publish',
  active: 'Live',
  paused: 'Paused',
  archived: 'Archived',
};

/** The only state in which an agent may answer or place a call. */
export const LIVE_STATE: AgentState = 'active';

export function allowedTransitions(from: AgentState): AgentState[] {
  if (from === 'draft') return ['testing', 'archived'];
  if (from === 'testing') return ['draft', 'ready', 'archived'];
  if (from === 'ready') return ['active', 'draft', 'archived'];
  if (from === 'active') return ['paused', 'draft'];
  if (from === 'paused') return ['active', 'draft', 'archived'];
  // Archived is recoverable, but only back to draft — never straight to live.
  // An agent nobody has looked at since it was archived should not be able to
  // start answering customers on one click.
  return ['draft'];
}

export function canTransition(from: AgentState, to: AgentState) {
  return allowedTransitions(from).includes(to);
}

/* ------------------------------------------------------------------ *
 * Readiness
 * ------------------------------------------------------------------ */

export type AgentConfig = {
  name?: string | null;
  systemPrompt?: string | null;
  welcomeMessage?: string | null;
  primaryLanguage?: string | null;
  voiceName?: string | null;
  voiceProfileId?: string | null;
  tools?: string[];
};

export type Readiness = {
  ready: boolean;
  /** Each missing piece, named. Not a disabled button with no explanation. */
  missing: string[];
  /** Worth fixing, but not blocking. */
  warnings: string[];
};

export const MIN_PROMPT_LENGTH = 40;

export function publishReadiness(config: AgentConfig): Readiness {
  const missing: string[] = [];
  const warnings: string[] = [];
  const text = (value: string | null | undefined) => (value ?? '').trim();

  if (!text(config.name)) missing.push('a name');
  const prompt = text(config.systemPrompt);
  if (!prompt) missing.push('a system prompt');
  else if (prompt.length < MIN_PROMPT_LENGTH)
    // Not a style preference: a two-word prompt produces an agent that
    // improvises everything, and it is the single most common way a
    // published agent goes wrong.
    missing.push(
      `a system prompt with something in it — ${prompt.length} characters is not instructions`,
    );
  if (!text(config.welcomeMessage)) missing.push('an opening line');
  if (!text(config.primaryLanguage)) missing.push('a language');
  if (!text(config.voiceName) && !text(config.voiceProfileId))
    missing.push('a voice');

  if ((config.tools ?? []).length === 0)
    warnings.push(
      'No tools are selected, so this agent can talk but cannot book, charge or look anything up.',
    );

  return { ready: missing.length === 0, missing, warnings };
}

/* ------------------------------------------------------------------ *
 * Versions
 * ------------------------------------------------------------------ */

/** The fields a version captures — everything that changes what the agent does. */
export const VERSIONED_FIELDS = [
  'name',
  'use_case',
  'welcome_message',
  'system_prompt',
  'primary_language',
  'voice_name',
  'voice_profile_id',
  'intelligence_profile',
  'temperature',
  'max_tokens',
  'endpointing_ms',
  'interrupt_words',
  'tools_json',
  'extractions_json',
  'calling_config_json',
  'send_policy_json',
] as const;

export const FIELD_LABEL: Record<string, string> = {
  name: 'name',
  use_case: 'use case',
  welcome_message: 'opening line',
  system_prompt: 'system prompt',
  primary_language: 'language',
  voice_name: 'voice',
  voice_profile_id: 'voice profile',
  intelligence_profile: 'intelligence profile',
  temperature: 'temperature',
  max_tokens: 'reply length',
  endpointing_ms: 'end-of-speech timing',
  interrupt_words: 'interruption sensitivity',
  tools_json: 'tools',
  extractions_json: 'extractions',
  calling_config_json: 'calling settings',
  send_policy_json: 'media send policy',
};

export type Snapshot = Record<string, unknown>;

/**
 * What differs between two versions.
 *
 * The point of this is the sentence shown before a rollback. "Restore version
 * 3" tells somebody nothing; "this changes the system prompt, the voice and
 * the tools" tells them whether to do it on a live agent.
 */
export function diffVersions(from: Snapshot, to: Snapshot): string[] {
  const changed: string[] = [];
  for (const field of VERSIONED_FIELDS) {
    if (!same(from?.[field], to?.[field]))
      changed.push(FIELD_LABEL[field] ?? field);
  }
  return changed;
}

function same(a: unknown, b: unknown) {
  return compare(a) === compare(b);
}

/** One comparable string per value, whatever shape the column held. */
function compare(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return JSON.stringify(value);
}

export function describeRollback(input: {
  version: number;
  changed: string[];
  isLive: boolean;
}): string {
  if (input.changed.length === 0)
    return `Version ${input.version} is identical to what is configured now — nothing would change.`;
  const list = input.changed.join(', ');
  const live = input.isLive
    ? ' This agent is live, so the change reaches the next call it takes.'
    : '';
  return `Restoring version ${input.version} changes: ${list}.${live}`;
}

/* ------------------------------------------------------------------ *
 * Cloning
 * ------------------------------------------------------------------ */

/**
 * A name for the copy that does not collide.
 *
 * Cloning exists so somebody can try a change without touching the agent that
 * is answering calls, so the copy must be obviously the copy.
 */
export function cloneName(original: string, existing: string[]): string {
  const base =
    original.replace(/\s*\(copy(?:\s+\d+)?\)\s*$/i, '').trim() || 'Agent';
  const taken = new Set(existing.map((name) => name.trim().toLowerCase()));
  const first = `${base} (copy)`;
  if (!taken.has(first.toLowerCase())) return first;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base} (copy ${index})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (copy ${Date.now()})`;
}

/* ------------------------------------------------------------------ *
 * Removing an agent
 * ------------------------------------------------------------------ */

/**
 * What still points at an agent, and therefore whether it can be deleted.
 *
 * An agent that was created by mistake and never used is just clutter, and
 * making somebody archive it forever is silly. One that has taken calls is a
 * different thing: `call_records.agent_id` is `ON DELETE SET NULL`, so
 * deleting it would blank the agent on every call it ever handled — the
 * history would survive and stop saying who did the work. `campaigns`,
 * `number_routes`, `payment_links` and `scheduled_actions` are the same, and
 * `agent_test_sessions` is worse: it cascades, so playground transcripts would
 * go with it.
 *
 * So: delete only what nothing references, archive everything else, and say
 * which one you are getting and why rather than offering a button that fails.
 */
export const AGENT_REFERENCE_LABELS = {
  calls: 'call',
  campaigns: 'campaign',
  routes: 'number route',
  tests: 'playground session',
  paymentLinks: 'payment link',
  scheduled: 'scheduled action',
} as const;

export type AgentReferenceCounts = Partial<
  Record<keyof typeof AGENT_REFERENCE_LABELS, number>
>;

export type AgentRemoval = {
  /** True when nothing points at it and the row can simply go. */
  deletable: boolean;
  /** What is holding it, in words, when it is not. */
  reason: string;
  counts: Array<{ label: string; count: number }>;
};

export function agentRemoval(counts: AgentReferenceCounts): AgentRemoval {
  const held = (
    Object.keys(AGENT_REFERENCE_LABELS) as Array<
      keyof typeof AGENT_REFERENCE_LABELS
    >
  )
    .map((key) => ({
      label: AGENT_REFERENCE_LABELS[key],
      count: Math.max(0, Math.round(Number(counts[key] ?? 0))),
    }))
    .filter((entry) => entry.count > 0);

  if (held.length === 0)
    return {
      deletable: true,
      reason: 'Nothing points at this agent, so it can be deleted outright.',
      counts: [],
    };

  const listed = held
    .map(
      (entry) =>
        `${entry.count} ${entry.count === 1 ? entry.label : `${entry.label}s`}`,
    )
    .join(', ');
  return {
    deletable: false,
    reason: `${listed} still point at this agent. Deleting it would blank the agent on work it actually did, so archive it instead — the name stays readable on every call it handled.`,
    counts: held,
  };
}
