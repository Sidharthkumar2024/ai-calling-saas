/**
 * Universal Object Engine (§7).
 *
 * A workspace defines its own objects — property, product, service, vehicle,
 * course, room, subscription, anything — and the AI reads real records instead
 * of improvising from a system prompt. Until now the vertical knowledge in this
 * product lived entirely in English prose inside `lib/agent-presets.ts`: the
 * real-estate preset told the model to "answer only from approved inventory"
 * and there was no inventory table for it to read.
 *
 * ## How a record is stored
 *
 * Two representations, on purpose:
 *
 *  - `records.values_json` is the **source of truth**. One row is one whole
 *    record, readable on its own, and adding a field never migrates a table.
 *  - `record_values` is a **projection** of the fields marked filterable, one
 *    row per value, typed into a text / number / date column. SQLite can index
 *    that; it cannot usefully index arbitrary JSON without creating an index
 *    per field at runtime.
 *
 * The projection is derived, never authoritative — it is rebuilt from the JSON
 * on every write, so the two cannot drift into disagreement.
 *
 * Everything here is pure so the field rules and the filter planner are
 * testable without a database — which matters most for the planner, because
 * that is where an injection bug would live.
 */

export type FieldType =
  | 'text'
  | 'long_text'
  | 'number'
  | 'currency'
  | 'date'
  | 'select'
  | 'boolean'
  | 'relation'
  | 'geo'
  | 'image'
  | 'file'
  | 'video'
  | 'model_3d'
  | 'inventory';

/** How a field's value is projected for filtering, and what it accepts. */
type FieldSpec = {
  /** Which typed column the projection writes to. */
  storage: 'text' | 'number' | 'date' | 'none';
  label: string;
  /** A URL-bearing field; validated as an absolute http(s) URL. */
  url?: boolean;
};

export const FIELD_TYPES: Record<FieldType, FieldSpec> = {
  text: { storage: 'text', label: 'Text' },
  long_text: { storage: 'none', label: 'Long text' },
  number: { storage: 'number', label: 'Number' },
  currency: { storage: 'number', label: 'Currency' },
  date: { storage: 'date', label: 'Date' },
  select: { storage: 'text', label: 'Choice' },
  boolean: { storage: 'number', label: 'Yes / no' },
  relation: { storage: 'text', label: 'Link to another record' },
  geo: { storage: 'none', label: 'Location' },
  image: { storage: 'none', label: 'Image', url: true },
  file: { storage: 'none', label: 'File', url: true },
  video: { storage: 'none', label: 'Video', url: true },
  model_3d: { storage: 'none', label: '3D tour', url: true },
  inventory: { storage: 'number', label: 'Inventory count' },
};

export const FIELD_TYPE_LIST = Object.keys(FIELD_TYPES) as FieldType[];

export function isFieldType(value: unknown): value is FieldType {
  return typeof value === 'string' && value in FIELD_TYPES;
}

export type FieldDefinition = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  filterable?: boolean;
  /** For `select`: the allowed values. */
  options?: string[];
  /** For `relation`: the object this field points at. */
  relatedObject?: string | null;
  /** For `currency`: ISO code the amount is stored in. */
  currency?: string | null;
};

/** Field and object keys are identifiers, not free text. */
export function slugifyKey(value: string, fallback = 'field') {
  const slug = String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || fallback;
}

export type NormalisedValue =
  | {
      ok: true;
      value: unknown;
      text: string | null;
      number: number | null;
      date: string | null;
    }
  | { ok: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/;

/**
 * Text for a scalar, and null for anything else. An object arriving in a text
 * field is a caller mistake; stringifying it would store "[object Object]" and
 * an agent would read that out on a call.
 */
function scalarText(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return null;
}

function urlValue(raw: unknown): NormalisedValue {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text)
    return { ok: true, value: null, text: null, number: null, date: null };
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, error: 'must be a full URL, including https://' };
  }
  // A record's media is rendered in a customer-facing page and read out by the
  // agent. `javascript:` and `data:` have no business there.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    return { ok: false, error: 'must be an http or https URL' };
  return {
    ok: true,
    value: parsed.toString(),
    text: null,
    number: null,
    date: null,
  };
}

/**
 * Coerces one submitted value into what the field's type accepts, and into the
 * typed slots the projection needs. Rejects rather than guesses: a number field
 * given "about twenty" is an error, not a 20.
 */
export function normaliseFieldValue(
  field: FieldDefinition,
  raw: unknown,
): NormalisedValue {
  const spec = FIELD_TYPES[field.type];
  if (!spec) return { ok: false, error: `unknown field type ${field.type}` };
  const empty = raw === null || raw === undefined || raw === '';

  if (empty) {
    if (field.required) return { ok: false, error: 'is required' };
    return { ok: true, value: null, text: null, number: null, date: null };
  }

  if (spec.url) return urlValue(raw);

  switch (field.type) {
    case 'text':
    case 'long_text': {
      const scalar = scalarText(raw);
      if (scalar === null) return { ok: false, error: 'must be text' };
      const text = scalar.trim().slice(0, field.type === 'text' ? 300 : 8000);
      return {
        ok: true,
        value: text,
        text: spec.storage === 'text' ? text.toLowerCase() : null,
        number: null,
        date: null,
      };
    }
    case 'number':
    case 'currency':
    case 'inventory': {
      const scalar = scalarText(raw);
      if (scalar === null) return { ok: false, error: 'must be a number' };
      const number =
        typeof raw === 'number' ? raw : Number(scalar.replace(/[,\s]/g, ''));
      if (!Number.isFinite(number))
        return { ok: false, error: 'must be a number' };
      if (field.type === 'inventory' && number < 0)
        return { ok: false, error: 'cannot be negative' };
      const rounded = field.type === 'inventory' ? Math.round(number) : number;
      return {
        ok: true,
        value: rounded,
        text: null,
        number: rounded,
        date: null,
      };
    }
    case 'boolean': {
      const scalar = scalarText(raw) ?? '';
      const truthy =
        raw === true || raw === 1 || /^(true|yes|1)$/i.test(scalar);
      const falsy =
        raw === false || raw === 0 || /^(false|no|0)$/i.test(scalar);
      if (!truthy && !falsy) return { ok: false, error: 'must be yes or no' };
      return {
        ok: true,
        value: truthy,
        text: null,
        number: truthy ? 1 : 0,
        date: null,
      };
    }
    case 'date': {
      const scalar = scalarText(raw);
      if (scalar === null) return { ok: false, error: 'must be a date' };
      const text = scalar.trim();
      if (!ISO_DATE.test(text))
        return { ok: false, error: 'must be a date like 2026-09-30' };
      const parsed = Date.parse(text);
      if (Number.isNaN(parsed))
        return { ok: false, error: 'is not a real date' };
      const iso = new Date(parsed).toISOString();
      return { ok: true, value: iso, text: null, number: null, date: iso };
    }
    case 'select': {
      const scalar = scalarText(raw);
      if (scalar === null) return { ok: false, error: 'must be a choice' };
      const text = scalar.trim();
      const options = field.options ?? [];
      if (options.length && !options.includes(text))
        return { ok: false, error: `must be one of: ${options.join(', ')}` };
      return {
        ok: true,
        value: text,
        text: text.toLowerCase(),
        number: null,
        date: null,
      };
    }
    case 'relation': {
      const scalar = scalarText(raw);
      if (scalar === null) return { ok: false, error: 'must be a record id' };
      const text = scalar.trim().slice(0, 80);
      if (!/^[A-Za-z0-9_\-.]+$/.test(text))
        return { ok: false, error: 'must be a record id' };
      return {
        ok: true,
        value: text,
        text: text.toLowerCase(),
        number: null,
        date: null,
      };
    }
    case 'geo': {
      const point =
        typeof raw === 'object' && raw !== null
          ? (raw as { lat?: unknown; lng?: unknown })
          : parseGeoText(scalarText(raw) ?? '');
      const lat = Number(point?.lat);
      const lng = Number(point?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng))
        return { ok: false, error: 'must be "latitude, longitude"' };
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180)
        return { ok: false, error: 'is not a point on Earth' };
      return {
        ok: true,
        value: { lat, lng },
        text: null,
        number: null,
        date: null,
      };
    }
    default:
      return { ok: false, error: `unsupported field type ${field.type}` };
  }
}

function parseGeoText(text: string) {
  const parts = text.split(',').map((part) => part.trim());
  if (parts.length !== 2) return null;
  return { lat: parts[0], lng: parts[1] };
}

export type ValidatedRecord = {
  ok: boolean;
  values: Record<string, unknown>;
  errors: Array<{ field: string; message: string }>;
  /** One row per filterable field with a value, for the projection table. */
  projection: Array<{
    key: string;
    text: string | null;
    number: number | null;
    date: string | null;
  }>;
  /** Lower-cased haystack for plain-text search. */
  searchText: string;
};

/**
 * Validates a whole record against its object's fields. Unknown keys are
 * dropped rather than stored: a record must be describable by its own schema,
 * or the schema is wrong.
 */
export function validateRecord(
  fields: FieldDefinition[],
  input: Record<string, unknown>,
): ValidatedRecord {
  const values: Record<string, unknown> = {};
  const errors: ValidatedRecord['errors'] = [];
  const projection: ValidatedRecord['projection'] = [];
  const haystack: string[] = [];

  for (const field of fields) {
    const result = normaliseFieldValue(field, input[field.key]);
    if (!result.ok) {
      errors.push({
        field: field.key,
        message: `${field.label} ${result.error}`,
      });
      continue;
    }
    if (result.value === null || result.value === undefined) continue;
    values[field.key] = result.value;
    if (typeof result.value === 'string')
      haystack.push(result.value.toLowerCase());
    else if (typeof result.value === 'number')
      haystack.push(String(result.value));
    if (field.filterable && FIELD_TYPES[field.type].storage !== 'none')
      projection.push({
        key: field.key,
        text: result.text,
        number: result.number,
        date: result.date,
      });
  }

  return {
    ok: errors.length === 0,
    values,
    errors,
    projection,
    searchText: haystack.join(' ').slice(0, 4000),
  };
}

export type Filter = {
  field: string;
  operator: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'in';
  value: unknown;
};

export type FilterPlan = {
  /** SQL fragments to AND together, each already parameterised. */
  clauses: string[];
  bindings: unknown[];
  /** Filters that were dropped, and why — reported, never silently ignored. */
  skipped: Array<{ field: string; reason: string }>;
};

const NUMERIC_OPERATORS = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte']);

/**
 * Turns requested filters into parameterised EXISTS clauses over the
 * projection table.
 *
 * Every value is a binding and every identifier is checked against the object's
 * own field list, so a filter can never reach SQL as text. An unknown field or
 * an operator the field's type cannot support is *reported*, not dropped
 * quietly — a filter that silently does nothing returns a confident, wrong
 * answer, which on a sales call is worse than an error.
 */
export function buildFilterPlan(
  fields: FieldDefinition[],
  filters: Filter[],
): FilterPlan {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const clauses: string[] = [];
  const bindings: unknown[] = [];
  const skipped: FilterPlan['skipped'] = [];

  for (const filter of filters ?? []) {
    const field = byKey.get(filter.field);
    if (!field) {
      skipped.push({ field: String(filter.field), reason: 'no such field' });
      continue;
    }
    if (!field.filterable) {
      skipped.push({ field: field.key, reason: 'field is not filterable' });
      continue;
    }
    const storage = FIELD_TYPES[field.type].storage;
    if (storage === 'none') {
      skipped.push({
        field: field.key,
        reason: `${field.type} cannot be filtered`,
      });
      continue;
    }
    const column =
      storage === 'number'
        ? 'number_value'
        : storage === 'date'
          ? 'date_value'
          : 'text_value';

    if (filter.operator === 'in') {
      const list = Array.isArray(filter.value) ? filter.value : [filter.value];
      const normalised = list
        .map((item) => normaliseFieldValue(field, item))
        .filter(
          (result): result is Extract<NormalisedValue, { ok: true }> =>
            result.ok,
        );
      if (!normalised.length) {
        skipped.push({ field: field.key, reason: 'no usable values' });
        continue;
      }
      const placeholders = normalised.map(() => '?').join(', ');
      clauses.push(
        `EXISTS (SELECT 1 FROM record_values v WHERE v.record_id = r.id AND v.field_key = ? AND v.${column} IN (${placeholders}))`,
      );
      bindings.push(
        field.key,
        ...normalised.map((result) => projectionValue(result, storage)),
      );
      continue;
    }

    if (filter.operator === 'contains') {
      if (storage !== 'text') {
        skipped.push({
          field: field.key,
          reason: 'contains only applies to text',
        });
        continue;
      }
      const text = (scalarText(filter.value) ?? '').trim().toLowerCase();
      if (!text) {
        skipped.push({ field: field.key, reason: 'empty search text' });
        continue;
      }
      clauses.push(
        `EXISTS (SELECT 1 FROM record_values v WHERE v.record_id = r.id AND v.field_key = ? AND v.text_value LIKE ? ESCAPE '\\')`,
      );
      bindings.push(field.key, `%${escapeLike(text)}%`);
      continue;
    }

    if (!NUMERIC_OPERATORS.has(filter.operator)) {
      skipped.push({
        field: field.key,
        reason: `unsupported operator ${filter.operator}`,
      });
      continue;
    }
    const result = normaliseFieldValue(field, filter.value);
    if (!result.ok) {
      skipped.push({ field: field.key, reason: result.error });
      continue;
    }
    const sqlOperator = {
      eq: '=',
      ne: '!=',
      lt: '<',
      lte: '<=',
      gt: '>',
      gte: '>=',
    }[filter.operator];
    clauses.push(
      `EXISTS (SELECT 1 FROM record_values v WHERE v.record_id = r.id AND v.field_key = ? AND v.${column} ${sqlOperator} ?)`,
    );
    bindings.push(field.key, projectionValue(result, storage));
  }

  return { clauses, bindings, skipped };
}

function projectionValue(
  result: Extract<NormalisedValue, { ok: true }>,
  storage: 'text' | 'number' | 'date',
) {
  if (storage === 'number') return result.number;
  if (storage === 'date') return result.date;
  return result.text;
}

/** `%` and `_` are wildcards in LIKE; a customer searching for "3_BHK" means it. */
function escapeLike(text: string) {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Human-readable one-liner for a record, used in agent tool results. */
export function summariseRecord(
  fields: FieldDefinition[],
  values: Record<string, unknown>,
  limit = 6,
) {
  const parts: string[] = [];
  for (const field of fields) {
    const value = values[field.key];
    if (value === null || value === undefined || value === '') continue;
    if (FIELD_TYPES[field.type].url) continue;
    if (field.type === 'geo') continue;
    parts.push(`${field.label}: ${formatValue(field, value)}`);
    if (parts.length >= limit) break;
  }
  return parts.join(' · ');
}

function formatValue(field: FieldDefinition, value: unknown) {
  if (field.type === 'currency' && typeof value === 'number')
    return `${field.currency ?? 'INR'} ${value.toLocaleString('en-IN')}`;
  if (field.type === 'boolean') return value ? 'yes' : 'no';
  if (field.type === 'date' && typeof value === 'string')
    return value.slice(0, 10);
  return String(value);
}
