import { getRawDb } from '@/db/index';
import {
  buildFilterPlan,
  summariseRecord,
  validateRecord,
  type FieldDefinition,
  type Filter,
} from '@/lib/object-engine';

/**
 * Storage for the Universal Object Engine (§7).
 *
 * Everything that reads or writes a record goes through here, so the JSON and
 * its filter projection are written in one place and cannot drift apart. The
 * decisions about *what is valid* live in `lib/object-engine.ts`, which is pure
 * and tested; this file only talks to the database.
 */

export type ObjectDefinition = {
  id: string;
  key: string;
  name: string;
  pluralName: string;
  description: string | null;
  titleField: string | null;
  status: string;
  fields: FieldDefinition[];
};

type ObjectRow = {
  id: string;
  key: string;
  name: string;
  plural_name: string | null;
  description: string | null;
  title_field: string | null;
  status: string;
};

type FieldRow = {
  object_id: string;
  key: string;
  label: string;
  type: string;
  required: number;
  filterable: number;
  options_json: string;
  related_object: string | null;
  currency: string | null;
};

function toField(row: FieldRow): FieldDefinition {
  let options: string[] = [];
  try {
    const parsed = JSON.parse(row.options_json || '[]') as unknown;
    if (Array.isArray(parsed)) options = parsed.map((item) => String(item));
  } catch {
    options = [];
  }
  return {
    key: row.key,
    label: row.label,
    type: row.type as FieldDefinition['type'],
    required: row.required === 1,
    filterable: row.filterable === 1,
    options,
    relatedObject: row.related_object,
    currency: row.currency,
  };
}

/** Every object a workspace has defined, with its fields. */
export async function listObjects(organizationId: string) {
  const db = getRawDb();
  const [objects, fields] = await Promise.all([
    db
      .prepare(
        `SELECT id, key, name, plural_name, description, title_field, status
         FROM custom_objects WHERE organization_id = ? ORDER BY name`,
      )
      .bind(organizationId)
      .all<ObjectRow>(),
    db
      .prepare(
        `SELECT object_id, key, label, type, required, filterable, options_json,
           related_object, currency
         FROM custom_fields WHERE organization_id = ? ORDER BY position, key`,
      )
      .bind(organizationId)
      .all<FieldRow>(),
  ]);
  const byObject = new Map<string, FieldDefinition[]>();
  for (const row of fields.results ?? []) {
    const list = byObject.get(row.object_id) ?? [];
    list.push(toField(row));
    byObject.set(row.object_id, list);
  }
  return (objects.results ?? []).map<ObjectDefinition>((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    pluralName: row.plural_name || row.name,
    description: row.description,
    titleField: row.title_field,
    status: row.status,
    fields: byObject.get(row.id) ?? [],
  }));
}

/** One object by key or id, scoped to the workspace. */
export async function getObject(organizationId: string, keyOrId: string) {
  const db = getRawDb();
  const row = await db
    .prepare(
      `SELECT id, key, name, plural_name, description, title_field, status
       FROM custom_objects WHERE organization_id = ? AND (key = ? OR id = ?) LIMIT 1`,
    )
    .bind(organizationId, keyOrId, keyOrId)
    .first<ObjectRow>();
  if (!row) return null;
  const fields = await db
    .prepare(
      `SELECT object_id, key, label, type, required, filterable, options_json,
         related_object, currency
       FROM custom_fields WHERE object_id = ? ORDER BY position, key`,
    )
    .bind(row.id)
    .all<FieldRow>();
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    pluralName: row.plural_name || row.name,
    description: row.description,
    titleField: row.title_field,
    status: row.status,
    fields: (fields.results ?? []).map(toField),
  } satisfies ObjectDefinition;
}

export type SaveRecordResult =
  | { ok: true; id: string; title: string; created: boolean }
  | { ok: false; errors: Array<{ field: string; message: string }> };

/**
 * Creates or replaces a record. The JSON and the projection are written in one
 * batch, so a half-written record cannot be searched.
 */
export async function saveRecord(input: {
  organizationId: string;
  object: ObjectDefinition;
  values: Record<string, unknown>;
  recordId?: string | null;
  externalId?: string | null;
  status?: string;
  createdBy?: string | null;
}): Promise<SaveRecordResult> {
  const validated = validateRecord(input.object.fields, input.values);
  if (!validated.ok) return { ok: false, errors: validated.errors };

  const db = getRawDb();
  const titleField = input.object.titleField;
  const title =
    (titleField && typeof validated.values[titleField] === 'string'
      ? (validated.values[titleField] as string)
      : '') ||
    summariseRecord(input.object.fields, validated.values, 2) ||
    'Untitled';

  let recordId = input.recordId ?? null;
  if (recordId) {
    const owned = await db
      .prepare(
        `SELECT id FROM records WHERE id = ? AND organization_id = ? AND object_id = ? LIMIT 1`,
      )
      .bind(recordId, input.organizationId, input.object.id)
      .first<{ id: string }>();
    if (!owned)
      return {
        ok: false,
        errors: [{ field: 'id', message: 'Record not found.' }],
      };
  } else if (input.externalId) {
    // An import that runs twice must update the same row rather than duplicate
    // the catalogue.
    const existing = await db
      .prepare(
        `SELECT id FROM records WHERE object_id = ? AND external_id = ? LIMIT 1`,
      )
      .bind(input.object.id, input.externalId)
      .first<{ id: string }>();
    recordId = existing?.id ?? null;
  }

  const created = !recordId;
  const id = recordId ?? `record_${crypto.randomUUID()}`;
  const status = input.status === 'draft' ? 'draft' : 'published';

  const statements = [
    created
      ? db
          .prepare(
            `INSERT INTO records (id, organization_id, object_id, title, values_json,
               search_text, status, external_id, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            input.organizationId,
            input.object.id,
            title,
            JSON.stringify(validated.values),
            validated.searchText,
            status,
            input.externalId ?? null,
            input.createdBy ?? null,
          )
      : db
          .prepare(
            `UPDATE records SET title = ?, values_json = ?, search_text = ?, status = ?,
               updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND organization_id = ?`,
          )
          .bind(
            title,
            JSON.stringify(validated.values),
            validated.searchText,
            status,
            id,
            input.organizationId,
          ),
    // Rebuilt wholesale: a field cleared on this write must not survive in the
    // projection and keep matching filters.
    db.prepare(`DELETE FROM record_values WHERE record_id = ?`).bind(id),
    ...validated.projection.map((entry) =>
      db
        .prepare(
          `INSERT INTO record_values (record_id, field_key, text_value, number_value, date_value)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(id, entry.key, entry.text, entry.number, entry.date),
    ),
  ];
  await db.batch(statements);
  return { ok: true, id, title, created };
}

export type RecordSearch = {
  records: Array<{
    id: string;
    title: string;
    status: string;
    values: Record<string, unknown>;
    summary: string;
  }>;
  total: number;
  /** Filters that could not be applied, and why. Never silently dropped. */
  skippedFilters: Array<{ field: string; reason: string }>;
};

/**
 * Searches records. `publishedOnly` is what the agent uses: a draft record is
 * one the workspace has not stood behind yet, and quoting it on a live call
 * would be quoting something nobody approved.
 */
export async function searchRecords(input: {
  organizationId: string;
  object: ObjectDefinition;
  filters?: Filter[];
  text?: string | null;
  limit?: number;
  offset?: number;
  publishedOnly?: boolean;
}): Promise<RecordSearch> {
  const db = getRawDb();
  const plan = buildFilterPlan(input.object.fields, input.filters ?? []);
  const where = [`r.organization_id = ?`, `r.object_id = ?`];
  const bindings: unknown[] = [input.organizationId, input.object.id];
  if (input.publishedOnly) where.push(`r.status = 'published'`);
  const text = (input.text ?? '').trim().toLowerCase();
  if (text) {
    where.push(`r.search_text LIKE ? ESCAPE '\\'`);
    bindings.push(`%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
  }
  where.push(...plan.clauses);
  bindings.push(...plan.bindings);

  const limit = Math.max(1, Math.min(100, input.limit ?? 20));
  const offset = Math.max(0, input.offset ?? 0);
  const clause = where.join(' AND ');

  const [rows, count] = await Promise.all([
    db
      .prepare(
        `SELECT r.id, r.title, r.status, r.values_json FROM records r
         WHERE ${clause} ORDER BY r.updated_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, limit, offset)
      .all<{
        id: string;
        title: string;
        status: string;
        values_json: string;
      }>(),
    db
      .prepare(`SELECT count(*) AS total FROM records r WHERE ${clause}`)
      .bind(...bindings)
      .first<{ total: number }>(),
  ]);

  return {
    records: (rows.results ?? []).map((row) => {
      const values = safeValues(row.values_json);
      return {
        id: row.id,
        title: row.title,
        status: row.status,
        values,
        summary: summariseRecord(input.object.fields, values),
      };
    }),
    total: Number(count?.total ?? 0),
    skippedFilters: plan.skipped,
  };
}

export async function getRecord(
  organizationId: string,
  object: ObjectDefinition,
  recordId: string,
) {
  const row = await getRawDb()
    .prepare(
      `SELECT id, title, status, values_json FROM records
       WHERE id = ? AND organization_id = ? AND object_id = ? LIMIT 1`,
    )
    .bind(recordId, organizationId, object.id)
    .first<{
      id: string;
      title: string;
      status: string;
      values_json: string;
    }>();
  if (!row) return null;
  const values = safeValues(row.values_json);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    values,
    summary: summariseRecord(object.fields, values),
  };
}

function safeValues(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Adjusts an inventory field by a delta, refusing to go below zero.
 *
 * Done in SQL rather than read-modify-write so two calls reserving the last
 * unit cannot both succeed — the check and the decrement are one statement.
 */
export async function adjustInventory(input: {
  organizationId: string;
  object: ObjectDefinition;
  recordId: string;
  fieldKey: string;
  delta: number;
}) {
  const field = input.object.fields.find(
    (entry) => entry.key === input.fieldKey,
  );
  if (!field || field.type !== 'inventory')
    return { ok: false as const, reason: 'not_an_inventory_field' };
  const db = getRawDb();
  const result = await db
    .prepare(
      `UPDATE records
       SET values_json = json_set(values_json, '$.' || ?, max(0, coalesce(json_extract(values_json, '$.' || ?), 0) + ?)),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND organization_id = ? AND object_id = ?
         AND coalesce(json_extract(values_json, '$.' || ?), 0) + ? >= 0`,
    )
    .bind(
      input.fieldKey,
      input.fieldKey,
      input.delta,
      input.recordId,
      input.organizationId,
      input.object.id,
      input.fieldKey,
      input.delta,
    )
    .run();
  if (!result.meta.changes)
    return { ok: false as const, reason: 'insufficient_inventory' };
  const after = await db
    .prepare(
      `SELECT json_extract(values_json, '$.' || ?) AS value FROM records WHERE id = ?`,
    )
    .bind(input.fieldKey, input.recordId)
    .first<{ value: number }>();
  const remaining = Number(after?.value ?? 0);
  await db
    .prepare(
      `UPDATE record_values SET number_value = ? WHERE record_id = ? AND field_key = ?`,
    )
    .bind(remaining, input.recordId, input.fieldKey)
    .run();
  return { ok: true as const, remaining };
}
