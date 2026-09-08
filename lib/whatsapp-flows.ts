/**
 * WhatsApp Flows — a form the customer fills in without leaving WhatsApp.
 *
 * The third way to reach somebody on WhatsApp, after a typed reply inside the
 * 24-hour window and an approved template outside it. A Flow is a small set of
 * screens with real controls — a dropdown, a date, a paragraph — and the
 * answers come back in one piece instead of being assembled from six
 * back-and-forth messages that each risk being abandoned halfway.
 *
 * What this covers and what it does not, said plainly because the difference
 * decides what a workspace can build:
 *
 * A **static** Flow is defined once, published at Meta, and answered entirely
 * on the customer's phone; the answers arrive in the webhook as one reply.
 * That is what this implements.
 *
 * A **dynamic** Flow calls the business's own endpoint between screens, with
 * an RSA-wrapped AES-GCM exchange, so screen two can depend on screen one.
 * That is not implemented, and a Flow written here never claims an endpoint —
 * an endpoint that half-works would leave customers staring at a screen that
 * never loads.
 *
 * Pure — no database, no fetch — so the rules and the response parsing are
 * tested directly.
 */

/** The controls a Flow screen can carry. */
export const FLOW_FIELD_TYPES = [
  'text',
  'paragraph',
  'number',
  'email',
  'phone',
  'date',
  'dropdown',
  'radio',
  'checkbox',
  'opt_in',
] as const;

export type FlowFieldType = (typeof FLOW_FIELD_TYPES)[number];

export type FlowField = {
  /** The key the answer comes back under. */
  name: string;
  label: string;
  type: FlowFieldType;
  required: boolean;
  /** For dropdown, radio and checkbox: the choices, which are the answers. */
  options?: string[];
};

export type FlowScreen = {
  id: string;
  title: string;
  fields: FlowField[];
};

export type FlowStatus =
  | 'draft'
  | 'DRAFT'
  | 'PUBLISHED'
  | 'DEPRECATED'
  | 'BLOCKED'
  | 'THROTTLED';

export type Flow = {
  id: string;
  name: string;
  screens: FlowScreen[];
  status: FlowStatus;
  provider_id: string | null;
  cta_label: string;
};

export const NAME_PATTERN = /^[A-Za-z0-9 _-]{3,80}$/;
export const SCREEN_ID_PATTERN = /^[A-Z][A-Z0-9_]{0,39}$/;
export const FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
export const MAX_SCREENS = 8;
export const MAX_FIELDS = 12;
export const CTA_LIMIT = 20;

const CHOICE_TYPES: FlowFieldType[] = ['dropdown', 'radio', 'checkbox'];

/** Whether this field's answer is chosen from a list rather than typed. */
export function isChoice(type: FlowFieldType): boolean {
  return CHOICE_TYPES.includes(type);
}

/**
 * Every reason Meta or a customer would reject this, said at once.
 *
 * Same reasoning as the template validator: a Flow is reviewed and published
 * before anybody sees it, so a rule broken here is found hours later in a
 * status field rather than in front of the person who wrote it.
 */
export function validateFlow(input: {
  name: string;
  ctaLabel?: string;
  screens: FlowScreen[];
}): string[] {
  const problems: string[] = [];
  if (!NAME_PATTERN.test((input.name ?? '').trim()))
    problems.push('Give the flow a name of 3–80 letters, numbers or spaces.');
  const cta = (input.ctaLabel ?? '').trim();
  if (cta && cta.length > CTA_LIMIT)
    problems.push(`The button label must be ${CTA_LIMIT} characters or fewer.`);

  const screens = Array.isArray(input.screens) ? input.screens : [];
  if (screens.length < 1 || screens.length > MAX_SCREENS)
    problems.push(`Use between 1 and ${MAX_SCREENS} screens.`);

  const screenIds = new Set<string>();
  const fieldNames = new Set<string>();
  for (const screen of screens) {
    const id = (screen?.id ?? '').trim();
    if (!SCREEN_ID_PATTERN.test(id))
      problems.push(
        `Screen ids are capitals, digits and underscores, like DETAILS — "${id || '(empty)'}" is not.`,
      );
    else if (screenIds.has(id))
      problems.push(`Two screens are both called ${id}.`);
    screenIds.add(id);
    if (!(screen?.title ?? '').trim())
      problems.push(`Screen ${id || '(unnamed)'} needs a heading.`);

    const fields = Array.isArray(screen?.fields) ? screen.fields : [];
    if (fields.length < 1 || fields.length > MAX_FIELDS)
      problems.push(
        `Screen ${id || '(unnamed)'} needs between 1 and ${MAX_FIELDS} questions.`,
      );
    for (const field of fields) {
      const name = (field?.name ?? '').trim();
      if (!FIELD_NAME_PATTERN.test(name))
        problems.push(
          `Answer names are lowercase letters, digits and underscores — "${name || '(empty)'}" is not.`,
        );
      // The answers arrive in one flat object, so two fields sharing a name on
      // different screens means one of them silently overwrites the other.
      else if (fieldNames.has(name))
        problems.push(`Two questions both save their answer as ${name}.`);
      fieldNames.add(name);
      if (!(field?.label ?? '').trim())
        problems.push(
          `The question saved as ${name || '(unnamed)'} has no wording.`,
        );
      if (!FLOW_FIELD_TYPES.includes(field?.type))
        problems.push(
          `"${String(field?.type)}" is not a kind of question a flow can ask.`,
        );
      if (isChoice(field?.type)) {
        const options = (field.options ?? [])
          .map((o) => String(o).trim())
          .filter(Boolean);
        if (new Set(options).size < 2)
          problems.push(
            `"${field.label || name}" is a list to choose from, so it needs at least two different choices.`,
          );
      }
    }
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * The shape Meta wants
 * ------------------------------------------------------------------ */

/** Meta's component name for each of our field types. */
const COMPONENT: Record<FlowFieldType, string> = {
  text: 'TextInput',
  paragraph: 'TextArea',
  number: 'TextInput',
  email: 'TextInput',
  phone: 'TextInput',
  date: 'DatePicker',
  dropdown: 'Dropdown',
  radio: 'RadioButtonsGroup',
  checkbox: 'CheckboxGroup',
  opt_in: 'OptIn',
};

/** Meta's `input-type` for the text inputs that carry one. */
const INPUT_TYPE: Partial<Record<FlowFieldType, string>> = {
  number: 'number',
  email: 'email',
  phone: 'phone',
};

/**
 * Builds the Flow JSON Meta stores.
 *
 * Every screen ends in a footer that carries the answers forward, and the last
 * one completes the flow — a screen with no way off it is a customer stuck
 * inside WhatsApp with a form they cannot finish or leave.
 */
export function toFlowJson(input: {
  screens: FlowScreen[];
  version?: string;
}): Record<string, unknown> {
  const screens = input.screens;
  return {
    version: input.version ?? '5.0',
    screens: screens.map((screen, index) => {
      const last = index === screens.length - 1;
      const children: Record<string, unknown>[] = screen.fields.map((field) => {
        const component: Record<string, unknown> = {
          type: COMPONENT[field.type],
          name: field.name,
          label: field.label,
          required: field.required,
        };
        if (INPUT_TYPE[field.type])
          component['input-type'] = INPUT_TYPE[field.type];
        if (isChoice(field.type))
          component['data-source'] = (field.options ?? []).map(
            (option, at) => ({
              id: `${field.name}_${at}`,
              title: option,
            }),
          );
        return component;
      });
      children.push({
        type: 'Footer',
        label: last ? 'Done' : 'Continue',
        'on-click-action': last
          ? {
              name: 'complete',
              payload: Object.fromEntries(
                screens
                  .flatMap((entry) => entry.fields)
                  .map((field) => [field.name, `\${form.${field.name}}`]),
              ),
            }
          : {
              name: 'navigate',
              next: { type: 'screen', name: screens[index + 1].id },
            },
      });
      return {
        id: screen.id,
        title: screen.title,
        terminal: last || undefined,
        layout: {
          type: 'SingleColumnLayout',
          children: [
            { type: 'Form', name: `form_${screen.id.toLowerCase()}`, children },
          ],
        },
      };
    }),
  };
}

/* ------------------------------------------------------------------ *
 * What comes back
 * ------------------------------------------------------------------ */

export type FlowReply = {
  /** Ours, so the answers can be matched to the flow that asked. */
  flowToken: string;
  answers: Record<string, string>;
};

/**
 * Reads the answers out of an `nfm_reply`.
 *
 * Meta returns them as a JSON *string* inside the webhook, and everything in
 * it came from a phone, so nothing here trusts a shape: a value that is not a
 * string is rendered as one, a list is joined, and anything unreadable yields
 * no answers rather than a half-parsed record.
 */
export function parseFlowReply(raw: unknown): FlowReply | null {
  const responseJson =
    raw && typeof raw === 'object'
      ? (raw as { response_json?: unknown }).response_json
      : null;
  if (typeof responseJson !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return null;
  const record = parsed as Record<string, unknown>;
  const token = typeof record.flow_token === 'string' ? record.flow_token : '';
  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'flow_token') continue;
    if (!FIELD_NAME_PATTERN.test(key)) continue;
    answers[key] = flatten(value);
  }
  return { flowToken: token, answers };
}

function flatten(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value))
    return value.map(flatten).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    // A choice comes back as {id, title} on some component versions. The title
    // is what the customer read, so that is the answer worth keeping.
    const title = (value as { title?: unknown }).title;
    if (typeof title === 'string') return title.trim();
    return '';
  }
  if (typeof value === 'boolean') return value ? 'yes' : '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.trim().slice(0, 1000);
  // A symbol, a function, anything else a parser could not have produced from
  // JSON: no answer rather than "[object Object]" in a lead's record.
  return '';
}

/** Only a published flow can be sent to anybody. */
export function canSendFlow(flow: Flow): boolean {
  return flow.status === 'PUBLISHED';
}

/** Meta's status in the words of somebody who has to act on it. */
export function describeFlowStatus(flow: Flow): string {
  switch (flow.status) {
    case 'draft':
      return 'Written here, not sent to Meta yet.';
    case 'DRAFT':
      return 'At Meta as a draft. Publish it before it can be sent.';
    case 'PUBLISHED':
      return 'Published. It can be sent to a customer.';
    case 'DEPRECATED':
      return 'Deprecated at Meta. Existing sends may still open; new ones should not use it.';
    case 'BLOCKED':
      return 'Blocked by Meta. It cannot be opened until that is resolved.';
    case 'THROTTLED':
      return 'Throttled by Meta after too many errors. It opens for some customers and not others.';
    default:
      return 'Unknown status.';
  }
}
