/**
 * WhatsApp message templates.
 *
 * This is the other half of the reply window. Inside 24 hours of a customer's
 * last message a business may write whatever it likes; outside it, WhatsApp
 * accepts only a template Meta has already approved. Until now the product had
 * exactly one template name, hard-coded in the integration config and used for
 * payment links, so every conversation whose window had closed was simply over
 * — the inbox said why and offered nothing.
 *
 * Meta's rules are enforced here rather than discovered as a rejection days
 * later: a submitted template goes into review, and a name or body that breaks
 * a documented rule comes back hours afterwards with a message nobody sees.
 * What can be checked before submitting is checked before submitting.
 *
 * Pure — no database, no fetch — so the rules and the placeholder arithmetic
 * are tested directly.
 */

/** What Meta files a template under. It decides pricing and what is allowed. */
export const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * `draft` is ours — written here, never sent to Meta. The rest are Meta's own
 * review states, kept under their names so a status read back from the Graph
 * API needs no translation that could drift.
 */
export type TemplateStatus =
  | 'draft'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED'
  | 'IN_APPEAL'
  | 'PENDING_DELETION';

export type Template = {
  id: string;
  name: string;
  language: string;
  category: Category;
  header: string | null;
  body: string;
  footer: string | null;
  status: TemplateStatus;
  /** Meta's id, present once the template has been accepted for review. */
  provider_id: string | null;
  /** Meta's words when it refuses, kept verbatim. */
  rejected_reason: string | null;
};

/* ------------------------------------------------------------------ *
 * Placeholders
 * ------------------------------------------------------------------ */

/**
 * The `{{1}}` slots in a template body, in the order Meta numbers them.
 *
 * Returns the distinct indexes found, sorted. Duplicates are legal — the same
 * slot may appear twice — so the count of slots is not the count of matches.
 */
export function placeholders(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    const index = Number(match[1]);
    if (Number.isInteger(index) && index > 0) found.add(index);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Fills a body with the values a person typed.
 *
 * Missing values are left as the slot itself rather than replaced with an
 * empty string: a template sent with a hole in it reaches the customer as a
 * sentence with a word missing, and seeing `{{2}}` in the preview is how
 * somebody notices before pressing send.
 */
export function fillTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, digits: string) => {
    const value = params[Number(digits) - 1];
    return value === undefined || value === '' ? whole : value;
  });
}

/* ------------------------------------------------------------------ *
 * What Meta will accept
 * ------------------------------------------------------------------ */

export const NAME_PATTERN = /^[a-z0-9_]{1,512}$/;
export const BODY_LIMIT = 1024;
export const HEADER_LIMIT = 60;
export const FOOTER_LIMIT = 60;

export type Draft = {
  name: string;
  language: string;
  category: string;
  header?: string | null;
  body: string;
  footer?: string | null;
};

/**
 * Every reason Meta would refuse this, said at once.
 *
 * All of them, not the first: a person fixing one problem at a time across a
 * review queue that answers in hours is the failure this replaces.
 */
export function validateDraft(draft: Draft): string[] {
  const problems: string[] = [];
  const name = (draft.name ?? '').trim();
  if (!NAME_PATTERN.test(name))
    problems.push(
      'The name may use only lowercase letters, numbers and underscores.',
    );
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test((draft.language ?? '').trim()))
    problems.push('The language must look like "en" or "en_US".');
  if (!CATEGORIES.includes(draft.category as Category))
    problems.push('Choose Marketing, Utility or Authentication.');

  const body = (draft.body ?? '').trim();
  if (!body) problems.push('The message body cannot be empty.');
  if (body.length > BODY_LIMIT)
    problems.push(`The body must be ${BODY_LIMIT} characters or fewer.`);
  if ((draft.header ?? '').length > HEADER_LIMIT)
    problems.push(`The header must be ${HEADER_LIMIT} characters or fewer.`);
  if ((draft.footer ?? '').length > FOOTER_LIMIT)
    problems.push(`The footer must be ${FOOTER_LIMIT} characters or fewer.`);

  const slots = placeholders(body);
  // Meta numbers the variables itself and rejects a gap, so {{1}} {{3}} is not
  // a template with two variables — it is a rejection two hours from now.
  if (slots.some((slot, index) => slot !== index + 1))
    problems.push(
      'Number the variables {{1}}, {{2}}, {{3}} with no gaps and starting at 1.',
    );
  // Meta refuses a body that opens or closes on a variable, and refuses two
  // variables with nothing between them.
  if (/^\s*\{\{\s*\d+\s*\}\}/.test(body) || /\{\{\s*\d+\s*\}\}\s*$/.test(body))
    problems.push('The body cannot begin or end with a variable.');
  if (/\}\}\s*\{\{/.test(body))
    problems.push('Put some words between two variables.');
  return problems;
}

/* ------------------------------------------------------------------ *
 * What the workspace may do with one
 * ------------------------------------------------------------------ */

/** Meta's status in the words of somebody who has to act on it. */
export function describeStatus(template: Template): string {
  switch (template.status) {
    case 'draft':
      return 'Written here, not sent to Meta for review yet.';
    case 'PENDING':
      return 'With Meta for review. This usually takes minutes but can take a day.';
    case 'APPROVED':
      return 'Approved. It can be sent outside the 24-hour window.';
    case 'REJECTED':
      return template.rejected_reason
        ? `Meta rejected it: ${template.rejected_reason}`
        : 'Meta rejected it. Edit it and submit again.';
    case 'PAUSED':
      return 'Paused by Meta for poor feedback. It cannot be sent until it recovers.';
    case 'DISABLED':
      return 'Disabled by Meta. It cannot be sent again.';
    case 'IN_APPEAL':
      return 'Under appeal with Meta. It cannot be sent while the appeal is open.';
    case 'PENDING_DELETION':
      return 'Being deleted at Meta.';
    default:
      return 'Unknown status.';
  }
}

/** Only an approved template reaches a customer outside the window. */
export function canSend(template: Template): boolean {
  return template.status === 'APPROVED';
}

/** Whether submitting this to Meta would be a new review or a no-op. */
export function canSubmit(template: Template): boolean {
  return template.status === 'draft' || template.status === 'REJECTED';
}

/**
 * Checks the values typed for one send.
 *
 * Meta rejects a parameter containing a newline or a run of four spaces, and
 * the refusal arrives as a numbered error code rather than a sentence.
 */
export function validateParams(body: string, params: string[]): string[] {
  const slots = placeholders(body);
  const problems: string[] = [];
  for (const slot of slots) {
    const value = params[slot - 1];
    if (value === undefined || value.trim() === '')
      problems.push(`Fill in variable {{${slot}}}.`);
    else if (/[\n\t]/.test(value) || /\s{4}/.test(value))
      problems.push(
        `Variable {{${slot}}} cannot contain line breaks or long runs of spaces.`,
      );
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * Talking to Meta
 * ------------------------------------------------------------------ */

export type MetaComponent =
  | { type: 'HEADER'; format: 'TEXT'; text: string }
  | { type: 'BODY'; text: string; example?: { body_text: string[][] } }
  | { type: 'FOOTER'; text: string };

/**
 * The shape Meta's `/message_templates` endpoint wants.
 *
 * A body with variables must carry an example for each one or the submission
 * is rejected outright, which is a rule that costs a review cycle to learn.
 */
export function toMetaPayload(
  draft: Draft,
  examples: string[] = [],
): {
  name: string;
  language: string;
  category: string;
  components: MetaComponent[];
} {
  const components: MetaComponent[] = [];
  const header = (draft.header ?? '').trim();
  if (header) components.push({ type: 'HEADER', format: 'TEXT', text: header });
  const body = draft.body.trim();
  const slots = placeholders(body);
  const bodyComponent: MetaComponent = { type: 'BODY', text: body };
  if (slots.length)
    bodyComponent.example = {
      body_text: [slots.map((slot) => examples[slot - 1] || `sample ${slot}`)],
    };
  components.push(bodyComponent);
  const footer = (draft.footer ?? '').trim();
  if (footer) components.push({ type: 'FOOTER', text: footer });
  return {
    name: draft.name.trim(),
    language: draft.language.trim(),
    category: draft.category,
    components,
  };
}

/** The body text out of a template Meta hands back, for storing locally. */
export function bodyFromMeta(components: unknown): string {
  if (!Array.isArray(components)) return '';
  for (const component of components) {
    const part = component as { type?: unknown; text?: unknown };
    if (
      String(part.type).toUpperCase() === 'BODY' &&
      typeof part.text === 'string'
    )
      return part.text;
  }
  return '';
}
