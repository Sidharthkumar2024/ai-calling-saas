/**
 * The fields on a website lead form, and what an answer to one has to look
 * like.
 *
 * Used in three places that must agree exactly: the editor, the widget script
 * served to a visitor's browser, and the public endpoint that accepts what
 * they typed. The browser copy is a courtesy — anyone can post to the endpoint
 * directly — so the rule lives here and the endpoint enforces it.
 */

export type LeadFieldType =
  | 'text'
  | 'tel'
  | 'email'
  | 'number'
  | 'textarea'
  | 'select'
  | 'date'
  | 'checkbox';

export const FIELD_TYPES: LeadFieldType[] = [
  'text',
  'tel',
  'email',
  'number',
  'textarea',
  'select',
  'date',
  'checkbox',
];

export type LeadFormField = {
  key: string;
  label: string;
  type: LeadFieldType;
  required: boolean;
  /** Only for `select`: the choices, which are also the accepted answers. */
  options?: string[];
};

export const DEFAULT_LEAD_FIELDS: LeadFormField[] = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'phone', label: 'Phone', type: 'tel', required: true },
  { key: 'email', label: 'Email', type: 'email', required: false },
  {
    key: 'productInterest',
    label: 'Interested in',
    type: 'text',
    required: false,
  },
];

/** Keys the lead pipeline already uses for its own meaning. */
const RESERVED = [
  '__proto__',
  'constructor',
  'prototype',
  'pageUrl',
  'sourceType',
  'externalLeadId',
  'campaignName',
  'notes',
  'estimatedValue',
];

export function validateLeadFields(value: unknown): LeadFormField[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 12)
    throw new Error('Use 2–12 fields, including name and phone.');
  const seen = new Set<string>();
  const fields = value.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.key !== 'string' ||
      !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(item.key) ||
      RESERVED.includes(item.key) ||
      seen.has(item.key)
    )
      throw new Error('Each field needs a unique, supported key.');
    seen.add(item.key);
    if (
      typeof item.label !== 'string' ||
      !item.label.trim() ||
      item.label.length > 80
    )
      throw new Error('Field labels must be 1–80 characters.');
    // Name and phone are what a lead *is* here, so their types are not the
    // editor's to change — a phone collected as a date reaches the dialer as
    // something nobody can call.
    const type =
      item.key === 'phone'
        ? 'tel'
        : item.key === 'email'
          ? 'email'
          : ((item.type ?? 'text') as LeadFieldType);
    if (!FIELD_TYPES.includes(type))
      throw new Error('Unsupported form field type.');

    const field: LeadFormField = {
      key: item.key,
      label: item.label.trim(),
      type,
      required: ['name', 'phone'].includes(item.key) || item.required === true,
    };
    if (type === 'select') {
      // A dropdown whose choices are the accepted answers: an empty list is a
      // control a visitor cannot satisfy and a required field they can never
      // complete.
      const options = Array.isArray(item.options)
        ? (item.options as unknown[])
            .map((option) =>
              typeof option === 'string' ? option.trim().slice(0, 80) : '',
            )
            .filter(Boolean)
        : [];
      const unique = [...new Set(options)];
      if (unique.length < 2 || unique.length > 20)
        throw new Error(
          `Give "${field.label}" between 2 and 20 different choices.`,
        );
      field.options = unique;
    }
    return field;
  });
  if (!seen.has('name') || !seen.has('phone'))
    throw new Error('Name and phone fields cannot be removed.');
  return fields;
}

export function collectLeadFields(fields: LeadFormField[], value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Form answers must be an object.');
  const body = value as Record<string, unknown>;
  const answers: Record<string, string> = {};
  for (const field of fields) {
    const raw = body[field.key];
    // A checkbox arrives as a boolean from some clients and as "on" from a
    // plain HTML form post, and neither is wrong.
    const normalised =
      field.type === 'checkbox' && typeof raw === 'boolean'
        ? raw
          ? 'yes'
          : ''
        : field.type === 'checkbox' && (raw === 'on' || raw === 'true')
          ? 'yes'
          : raw;
    if (normalised != null && typeof normalised !== 'string')
      throw new Error(`${field.label} must be text.`);
    const text = typeof normalised === 'string' ? normalised.trim() : '';
    const limit = field.type === 'textarea' ? 5000 : 1000;
    if (text.length > limit || (field.required && !text))
      throw new Error(
        `Check ${field.label}: ${field.required ? 'required, ' : ''}maximum ${limit} characters.`,
      );
    if (
      text &&
      field.type === 'email' &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
    )
      throw new Error('Enter a valid email address.');
    if (text && field.type === 'number' && !Number.isFinite(Number(text)))
      throw new Error(`${field.label} must be a number.`);
    // A date the browser could not have produced was typed by something other
    // than the widget, and "2026-02-31" is not a day.
    if (text && field.type === 'date') {
      const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      const parsed = parts ? new Date(`${text}T00:00:00Z`) : null;
      if (
        !parts ||
        !parsed ||
        Number.isNaN(parsed.getTime()) ||
        parsed.getUTCMonth() + 1 !== Number(parts[2]) ||
        parsed.getUTCDate() !== Number(parts[3])
      )
        throw new Error(`${field.label} must be a date like 2026-03-14.`);
    }
    // The choices are the accepted answers. Anything else was not offered.
    if (
      text &&
      field.type === 'select' &&
      !(field.options ?? []).includes(text)
    )
      throw new Error(`Choose one of the offered options for ${field.label}.`);
    if (text && field.type === 'checkbox' && text !== 'yes')
      throw new Error(`${field.label} must be ticked or left empty.`);
    answers[field.key] = text;
  }
  if (!/^\+?[1-9]\d{6,14}$/.test((answers.phone ?? '').replace(/[\s()-]/g, '')))
    throw new Error('Enter a valid international phone number.');
  return answers;
}

export function safeLogo(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href.slice(0, 2000)
      : '';
  } catch {
    return '';
  }
}
