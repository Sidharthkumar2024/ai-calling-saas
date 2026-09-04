import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import {
  FIELD_TYPES,
  isFieldType,
  slugifyKey,
  type FieldDefinition,
} from '@/lib/object-engine';
import {
  getObject,
  listObjects,
  saveRecord,
  searchRecords,
} from '@/lib/object-store';
import { proposeSchema } from '@/lib/schema-builder';
import { OBJECT_TEMPLATES } from '@/lib/object-templates';

export const dynamic = 'force-dynamic';

/**
 * Universal Object Engine (§7-9).
 *
 * A workspace's own objects, their fields, and the records in them. Everything
 * a customer can define about what they sell lives here — until now the only
 * "catalogue" in the product was a free-text amount on a payment link.
 */
export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'crm.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const url = new URL(request.url);
  const objectKey = url.searchParams.get('object');

  const objects = await listObjects(organizationId);
  if (!objectKey)
    return NextResponse.json({
      objects,
      fieldTypes: Object.entries(FIELD_TYPES).map(([type, spec]) => ({
        type,
        label: spec.label,
        filterable: spec.storage !== 'none',
      })),
      templates: OBJECT_TEMPLATES.map((template) => ({
        key: template.key,
        name: template.name,
        industry: template.industry,
        description: template.description,
        objectCount: template.objects.length,
      })),
    });

  const object = objects.find(
    (entry) => entry.key === objectKey || entry.id === objectKey,
  );
  if (!object)
    return NextResponse.json({ error: 'Object not found.' }, { status: 404 });

  const result = await searchRecords({
    organizationId,
    object,
    text: url.searchParams.get('q'),
    limit: Number(url.searchParams.get('limit') ?? 25),
    offset: Number(url.searchParams.get('offset') ?? 0),
  });
  return NextResponse.json({ object, ...result });
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'crm.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;
  const body = (await request.json()) as {
    action?: string;
    objectKey?: string;
    name?: string;
    pluralName?: string;
    description?: string;
    titleField?: string;
    fields?: unknown;
    recordId?: string;
    values?: Record<string, unknown>;
    status?: string;
    externalId?: string;
    templateKey?: string;
    businessDescription?: string;
  };
  const db = getRawDb();

  if (body.action === 'create_object' || body.action === 'update_object') {
    const name = (body.name ?? '').trim().slice(0, 60);
    if (!name)
      return NextResponse.json(
        { error: 'A name is required.' },
        { status: 400 },
      );
    const fields = parseFields(body.fields);
    if ('error' in fields)
      return NextResponse.json({ error: fields.error }, { status: 400 });
    const key = slugifyKey(body.objectKey || name, 'object');

    const existing = await getObject(organizationId, key);
    if (body.action === 'create_object' && existing)
      return NextResponse.json(
        { error: `An object called "${key}" already exists.` },
        { status: 409 },
      );
    if (body.action === 'update_object' && !existing)
      return NextResponse.json({ error: 'Object not found.' }, { status: 404 });

    const objectId = existing?.id ?? `object_${crypto.randomUUID()}`;
    // A title field must be one of the object's own fields, or a record's
    // headline would silently fall back to a summary for ever.
    const titleField = fields.fields.some(
      (field) => field.key === body.titleField,
    )
      ? body.titleField!
      : (fields.fields.find((field) => field.type === 'text')?.key ?? null);

    await db.batch([
      existing
        ? db
            .prepare(
              `UPDATE custom_objects SET name = ?, plural_name = ?, description = ?,
                 title_field = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND organization_id = ?`,
            )
            .bind(
              name,
              (body.pluralName ?? '').trim().slice(0, 60) || `${name}s`,
              (body.description ?? '').trim().slice(0, 400) || null,
              titleField,
              objectId,
              organizationId,
            )
        : db
            .prepare(
              `INSERT INTO custom_objects (id, organization_id, key, name, plural_name,
                 description, title_field, source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              objectId,
              organizationId,
              key,
              name,
              (body.pluralName ?? '').trim().slice(0, 60) || `${name}s`,
              (body.description ?? '').trim().slice(0, 400) || null,
              titleField,
              'manual',
            ),
      // Fields are replaced wholesale. Records keep their JSON, so a field
      // removed here stops being editable and stops being filtered, but the
      // data it held is not destroyed by an edit to the schema.
      db
        .prepare(`DELETE FROM custom_fields WHERE object_id = ?`)
        .bind(objectId),
      ...fields.fields.map((field, index) =>
        db
          .prepare(
            `INSERT INTO custom_fields (id, organization_id, object_id, key, label, type,
               required, filterable, options_json, related_object, currency, position)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            `field_${crypto.randomUUID()}`,
            organizationId,
            objectId,
            field.key,
            field.label,
            field.type,
            field.required ? 1 : 0,
            field.filterable ? 1 : 0,
            JSON.stringify(field.options ?? []),
            field.relatedObject ?? null,
            field.currency ?? null,
            index,
          ),
      ),
    ]);
    await recordAudit(
      auth.session,
      existing ? 'object.updated' : 'object.created',
      'custom_object',
      objectId,
      { key, fields: fields.fields.length },
    );
    return NextResponse.json(
      { saved: true, id: objectId, key },
      { status: existing ? 200 : 201 },
    );
  }

  if (body.action === 'save_record') {
    const object = await getObject(organizationId, body.objectKey ?? '');
    if (!object)
      return NextResponse.json({ error: 'Object not found.' }, { status: 404 });
    const result = await saveRecord({
      organizationId,
      object,
      values: body.values ?? {},
      recordId: body.recordId ?? null,
      externalId: body.externalId ?? null,
      status: body.status,
      createdBy: auth.session.userId,
    });
    if (!result.ok)
      return NextResponse.json(
        { error: 'Some fields need fixing.', errors: result.errors },
        { status: 400 },
      );
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  }

  if (body.action === 'delete_record') {
    const object = await getObject(organizationId, body.objectKey ?? '');
    if (!object)
      return NextResponse.json({ error: 'Object not found.' }, { status: 404 });
    const result = await db
      .prepare(
        `DELETE FROM records WHERE id = ? AND organization_id = ? AND object_id = ?`,
      )
      .bind(body.recordId ?? '', organizationId, object.id)
      .run();
    if (!result.meta.changes)
      return NextResponse.json({ error: 'Record not found.' }, { status: 404 });
    await recordAudit(
      auth.session,
      'record.deleted',
      'record',
      body.recordId ?? '',
    );
    return NextResponse.json({ deleted: true });
  }

  if (body.action === 'apply_template') {
    const template = OBJECT_TEMPLATES.find(
      (entry) => entry.key === body.templateKey,
    );
    if (!template)
      return NextResponse.json(
        { error: 'Template not found.' },
        { status: 404 },
      );
    const created: string[] = [];
    const skipped: string[] = [];
    for (const definition of template.objects) {
      if (await getObject(organizationId, definition.key)) {
        skipped.push(definition.key);
        continue;
      }
      const objectId = `object_${crypto.randomUUID()}`;
      await db.batch([
        db
          .prepare(
            `INSERT INTO custom_objects (id, organization_id, key, name, plural_name,
               description, title_field, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'template')`,
          )
          .bind(
            objectId,
            organizationId,
            definition.key,
            definition.name,
            definition.pluralName,
            definition.description,
            definition.titleField,
          ),
        ...definition.fields.map((field, index) =>
          db
            .prepare(
              `INSERT INTO custom_fields (id, organization_id, object_id, key, label, type,
                 required, filterable, options_json, related_object, currency, position)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              `field_${crypto.randomUUID()}`,
              organizationId,
              objectId,
              field.key,
              field.label,
              field.type,
              field.required ? 1 : 0,
              field.filterable ? 1 : 0,
              JSON.stringify(field.options ?? []),
              field.relatedObject ?? null,
              field.currency ?? null,
              index,
            ),
        ),
      ]);
      created.push(definition.key);
    }
    await recordAudit(
      auth.session,
      'object.template_applied',
      'custom_object',
      template.key,
      {
        created,
        skipped,
      },
    );
    return NextResponse.json({ applied: true, created, skipped });
  }

  if (body.action === 'propose_schema') {
    const description = (body.businessDescription ?? '').trim();
    if (description.length < 20)
      return NextResponse.json(
        {
          error:
            'Describe the business in a sentence or two so there is something to work from.',
        },
        { status: 400 },
      );
    const proposal = await proposeSchema({ organizationId, description });
    // Deliberately not saved. §7 says the admin approves before anything is
    // created, so this returns a proposal the operator submits back as
    // `create_object` if they want it.
    return NextResponse.json(proposal, { status: proposal.ok ? 200 : 502 });
  }

  return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
}

/** Validates a submitted field list before any of it reaches the database. */
function parseFields(
  raw: unknown,
): { fields: FieldDefinition[] } | { error: string } {
  if (!Array.isArray(raw) || !raw.length)
    return { error: 'An object needs at least one field.' };
  if (raw.length > 60)
    return { error: 'An object may have at most 60 fields.' };
  const fields: FieldDefinition[] = [];
  const seen = new Set<string>();
  // Only real strings are read; an object arriving in a label would otherwise
  // be stored as "[object Object]".
  const str = (value: unknown) => (typeof value === 'string' ? value : '');
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const label = str(item.label).trim().slice(0, 60);
    if (!label) return { error: 'Every field needs a label.' };
    const type = item.type;
    if (!isFieldType(type))
      return { error: `"${label}" has an unknown field type.` };
    const base = slugifyKey(str(item.key) || label);
    let key = base;
    // A duplicate key would silently overwrite the earlier field's value.
    let suffix = 2;
    while (seen.has(key)) key = `${base}_${suffix++}`;
    seen.add(key);
    const options = Array.isArray(item.options)
      ? item.options
          .map((option) => String(option).trim())
          .filter(Boolean)
          .slice(0, 40)
      : [];
    fields.push({
      key,
      label,
      type,
      required: item.required === true,
      // A field can only be filterable if its type has somewhere to be stored.
      filterable:
        item.filterable === true && FIELD_TYPES[type].storage !== 'none',
      options,
      relatedObject: str(item.relatedObject)
        ? slugifyKey(str(item.relatedObject))
        : null,
      currency: str(item.currency).trim().slice(0, 8) || null,
    });
  }
  if (!fields.length) return { error: 'An object needs at least one field.' };
  return { fields };
}
