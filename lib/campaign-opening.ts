/**
 * Who an outbound campaign says it is (§19: "Campaign opening can use company
 * / sales team / executive / customer personalization").
 *
 * Today every campaign opens with the agent's one `welcome_message`, written
 * once, used for all of them. A recruitment call and a payment reminder from
 * the same workspace introduce themselves identically.
 *
 * The whole risk in personalisation is the hole. "Hello , this is UrbanNest"
 * or "Hello {{name}}" reaching a real person is worse than a generic opening,
 * and it is the default outcome of any template system that trusts its data.
 * So the rule here is:
 *
 *   **An opening is built only from values that are actually present. What is
 *   missing is reported, and the line degrades to the next honest
 *   identification rather than being emitted with a gap in it.**
 *
 * Pure: the modes, the build, and what a mode requires before it can be saved.
 */

export const OPENING_MODES = [
  'agent_default',
  'company',
  'team',
  'executive',
  'customer',
] as const;

export type OpeningMode = (typeof OPENING_MODES)[number];

export function isOpeningMode(value: unknown): value is OpeningMode {
  return (
    typeof value === 'string' &&
    (OPENING_MODES as readonly string[]).includes(value)
  );
}

export type OpeningConfig = {
  mode: OpeningMode;
  /** For `team`: "the admissions team". */
  team: string;
  /** For `executive`: the person the call is on behalf of. */
  executive: string;
  /** Optional one-line reason for calling, used by every mode but the default. */
  reason: string;
};

export const DEFAULT_OPENING: OpeningConfig = {
  mode: 'agent_default',
  team: '',
  executive: '',
  reason: '',
};

export function parseOpening(raw: unknown): OpeningConfig {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const text = (key: string, max: number) => {
    const value = input[key];
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  };
  const mode = input.mode;
  return {
    mode: isOpeningMode(mode) ? mode : 'agent_default',
    team: text('team', 60),
    executive: text('executive', 60),
    reason: text('reason', 120),
  };
}

export type OpeningProblem = { field: string; message: string };

/**
 * What a mode needs before a campaign may be saved with it.
 *
 * Checked here rather than at dial time: discovering that "executive" has no
 * executive when four hundred calls are already going out is discovering it
 * too late.
 */
export function openingProblems(config: OpeningConfig): OpeningProblem[] {
  const problems: OpeningProblem[] = [];
  if (config.mode === 'team' && !config.team)
    problems.push({
      field: 'team',
      message: 'Name the team the call is from, or the opening cannot say it.',
    });
  if (config.mode === 'executive' && !config.executive)
    problems.push({
      field: 'executive',
      message: 'Name the person this call is on behalf of.',
    });
  return problems;
}

export type Lead = {
  name?: string | null;
  productInterest?: string | null;
};

export type BuiltOpening = {
  /** The line the agent opens with, or null to use the agent's own welcome. */
  text: string | null;
  /** The mode actually used, which is not always the one asked for. */
  usedMode: OpeningMode;
  /** Values the mode wanted and this contact did not have. */
  missing: string[];
  /**
   * True when the requested personalisation could not be built and the line
   * fell back. Recorded so a campaign that silently degrades for every contact
   * is visible rather than assumed to be working.
   */
  degraded: boolean;
};

/**
 * Builds the opening for one contact.
 *
 * `customer` is the mode that fails most often, because it depends on the lead
 * row rather than on the campaign's own settings: a contact imported from a
 * CSV with only a phone number has no name to greet. That contact gets the
 * company opening, and the run records that it degraded.
 */
export function buildOpening(input: {
  config: OpeningConfig;
  businessName: string;
  agentName: string;
  lead?: Lead | null;
}): BuiltOpening {
  const config = input.config;
  const business = input.businessName.trim() || 'our company';
  const agent = input.agentName.trim() || 'your assistant';
  // The reason joins the same sentence rather than being appended after the
  // full stop. Rendered the other way it came out as "…from UrbanNest Realty.
  // about your recent enquiry." — a lowercase fragment sitting on its own,
  // which is what a caller would actually have heard.
  const reason = trimStop(config.reason.trim());
  const because = reason ? `, ${reason}` : '';

  if (config.mode === 'agent_default')
    return {
      text: null,
      usedMode: 'agent_default',
      missing: [],
      degraded: false,
    };

  if (config.mode === 'customer') {
    const name = (input.lead?.name ?? '').trim();
    const interest = (input.lead?.productInterest ?? '').trim();
    const missing: string[] = [];
    if (!name) missing.push('lead name');
    if (name) {
      // Only the parts that exist are spoken, and the author's own reason wins
      // over the lead's recorded interest — otherwise the line says "about"
      // twice: "…about the 3 BHK, about your site visit."
      const about = reason
        ? because
        : interest
          ? ` about ${trimStop(interest)}`
          : '';
      return {
        text: `Hello ${name}, this is ${agent} calling from ${business}${about}.`,
        usedMode: 'customer',
        missing: interest || reason ? [] : ['product interest'],
        degraded: false,
      };
    }
    // No name at all: fall back rather than open with "Hello , ".
    return {
      text: `Hello, this is ${agent} calling from ${business}.${because}`,
      usedMode: 'company',
      missing,
      degraded: true,
    };
  }

  if (config.mode === 'team') {
    const team = config.team.trim();
    if (!team)
      return {
        text: `Hello, this is ${agent} calling from ${business}${because}.`,
        usedMode: 'company',
        missing: ['team'],
        degraded: true,
      };
    return {
      text: `Hello, this is ${agent} from the ${stripTeam(team)} team at ${business}${because}.`,
      usedMode: 'team',
      missing: [],
      degraded: false,
    };
  }

  if (config.mode === 'executive') {
    const executive = config.executive.trim();
    if (!executive)
      return {
        text: `Hello, this is ${agent} calling from ${business}${because}.`,
        usedMode: 'company',
        missing: ['executive'],
        degraded: true,
      };
    return {
      text: `Hello, this is ${agent} calling on behalf of ${executive} at ${business}${because}.`,
      usedMode: 'executive',
      missing: [],
      degraded: false,
    };
  }

  return {
    text: `Hello, this is ${agent} calling from ${business}${because}.`,
    usedMode: 'company',
    missing: [],
    degraded: false,
  };
}

/** A preview for the settings screen, using a stand-in contact. */
export function previewOpening(input: {
  config: OpeningConfig;
  businessName: string;
  agentName: string;
}): BuiltOpening {
  return buildOpening({
    ...input,
    lead: { name: 'Priya', productInterest: 'the 3 BHK you enquired about' },
  });
}

function trimStop(value: string) {
  return value.replace(/[.!?]+$/, '');
}

/** "the sales team" typed into a field already followed by "team". */
function stripTeam(value: string) {
  return value.replace(/^the\s+/i, '').replace(/\s+team$/i, '');
}
