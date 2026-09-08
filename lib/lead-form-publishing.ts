/**
 * Drafts and what is actually on the website.
 *
 * A lead form had exactly one copy of itself. Editing a published popup wrote
 * straight over what visitors were being served — every keystroke saved went
 * live, and the screen said "saved as a new version" while it had in fact
 * replaced the running form. There was no way to work on next month's form
 * without changing this month's.
 *
 * So a published form is now a snapshot taken at the moment somebody pressed
 * publish. The draft is what the editor writes; the snapshot is what the
 * widget and the public endpoint read; and publishing is the only act that
 * moves one to the other.
 *
 * Pure — no database, no fetch — so the comparison and the state machine are
 * tested directly.
 */

import type { LeadFormField } from './lead-form-fields';

export type FormShape = {
  fields: LeadFormField[];
  settings: Record<string, unknown>;
  domains: string[];
};

/** The columns this module reasons about, named as the row carries them. */
export type FormRow = {
  status: string;
  fields_json: string;
  settings_json: string;
  allowed_domains_json: string;
  published_fields_json: string | null;
  published_settings_json: string | null;
  published_domains_json: string | null;
  published_version: number | null;
  version: number;
};

function parse<T>(value: string | null | undefined, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value) as unknown;
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** What the editor is working on. */
export function draftOf(row: FormRow): FormShape {
  return {
    fields: parse<LeadFormField[]>(row.fields_json, []),
    settings: parse<Record<string, unknown>>(row.settings_json, {}),
    domains: parse<string[]>(row.allowed_domains_json, []),
  };
}

/**
 * What visitors are being served, or null when nothing is.
 *
 * Null and "the draft" are different answers, and returning the draft when
 * there is no snapshot is exactly the bug this module exists to remove.
 */
export function publishedOf(row: FormRow): FormShape | null {
  if (row.status !== 'active' || row.published_fields_json == null) return null;
  return {
    fields: parse<LeadFormField[]>(row.published_fields_json, []),
    settings: parse<Record<string, unknown>>(row.published_settings_json, {}),
    domains: parse<string[]>(row.published_domains_json, []),
  };
}

export type PublishState =
  /** Never published. Nothing is on any website. */
  | 'draft'
  /** Published, and the draft matches what is live. */
  | 'published'
  /** Published, and the draft has moved on. */
  | 'unpublished_changes'
  /** Was published and has been taken down; the snapshot is kept. */
  | 'unpublished';

export function publishState(row: FormRow): PublishState {
  const published = publishedOf(row);
  if (!published)
    return row.published_fields_json == null ? 'draft' : 'unpublished';
  return sameShape(draftOf(row), published)
    ? 'published'
    : 'unpublished_changes';
}

/**
 * Whether two versions of a form would behave identically.
 *
 * Compared on meaning rather than on the JSON text: key order out of a
 * database is not a change a visitor could notice, and reporting it as one
 * would leave every form permanently claiming unpublished edits.
 */
export function sameShape(a: FormShape, b: FormShape): boolean {
  return (
    canonical(a.fields) === canonical(b.fields) &&
    canonical(a.settings) === canonical(b.settings) &&
    canonical([...a.domains].sort()) === canonical([...b.domains].sort())
  );
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * What publishing this draft would change for visitors, in plain words.
 *
 * Shown before the act, because publishing replaces a form people are filling
 * in right now and "are you sure" is a worse question than "this removes the
 * Budget field".
 */
export function publishDiff(row: FormRow): string[] {
  const published = publishedOf(row);
  const draft = draftOf(row);
  if (!published)
    return ['This puts the form on your website for the first time.'];
  const changes: string[] = [];

  const before = new Map(published.fields.map((field) => [field.key, field]));
  const after = new Map(draft.fields.map((field) => [field.key, field]));
  for (const [key, field] of after)
    if (!before.has(key)) changes.push(`Adds the "${field.label}" field.`);
  for (const [key, field] of before)
    if (!after.has(key)) changes.push(`Removes the "${field.label}" field.`);
  for (const [key, field] of after) {
    const was = before.get(key);
    if (!was) continue;
    if (was.label !== field.label)
      changes.push(`Renames "${was.label}" to "${field.label}".`);
    if (was.type !== field.type)
      changes.push(
        `Changes "${field.label}" from ${was.type} to ${field.type}.`,
      );
    if (was.required !== field.required)
      changes.push(
        field.required
          ? `Makes "${field.label}" required.`
          : `Makes "${field.label}" optional.`,
      );
    if (canonical(was.options ?? []) !== canonical(field.options ?? []))
      changes.push(`Changes the choices for "${field.label}".`);
  }

  const gained = draft.domains.filter(
    (origin) => !published.domains.includes(origin),
  );
  const lost = published.domains.filter(
    (origin) => !draft.domains.includes(origin),
  );
  for (const origin of gained) changes.push(`Allows ${origin}.`);
  // Worth its own sentence: this is the change that silently stops an existing
  // embed from working.
  for (const origin of lost)
    changes.push(`Stops accepting leads from ${origin}.`);

  if (canonical(published.settings) !== canonical(draft.settings))
    changes.push('Updates the wording and appearance.');
  return changes.length
    ? changes
    : ['Nothing — the draft matches what is live.'];
}
