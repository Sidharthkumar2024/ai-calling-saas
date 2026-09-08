export type LeadFormField = {
  key: string;
  label: string;
  type: 'text' | 'tel' | 'email' | 'number';
  required: boolean;
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
      [
        '__proto__',
        'constructor',
        'prototype',
        'pageUrl',
        'sourceType',
        'externalLeadId',
        'campaignName',
        'notes',
        'estimatedValue',
      ].includes(item.key) ||
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
    const type =
      item.key === 'phone'
        ? 'tel'
        : item.key === 'email'
          ? 'email'
          : (item.type ?? 'text');
    if (!['text', 'tel', 'email', 'number'].includes(type))
      throw new Error('Unsupported form field type.');
    return {
      key: item.key,
      label: item.label.trim(),
      type,
      required: ['name', 'phone'].includes(item.key) || item.required === true,
    } as LeadFormField;
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
    if (raw != null && typeof raw !== 'string')
      throw new Error(`${field.label} must be text.`);
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (text.length > 1000 || (field.required && !text))
      throw new Error(
        `Check ${field.label}: ${field.required ? 'required, ' : ''}maximum 1000 characters.`,
      );
    if (
      text &&
      field.type === 'email' &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
    )
      throw new Error('Enter a valid email address.');
    if (text && field.type === 'number' && !Number.isFinite(Number(text)))
      throw new Error(`${field.label} must be a number.`);
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
