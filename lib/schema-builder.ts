import { reasonWithTools } from '@/lib/provider-adapters';
import {
  FIELD_TYPES,
  FIELD_TYPE_LIST,
  isFieldType,
  slugifyKey,
  type FieldDefinition,
} from '@/lib/object-engine';

/**
 * AI Schema Builder (§7).
 *
 * Turns "we sell modular kitchens across Pune, mostly to builders" into a
 * proposed set of objects and fields. §7 is explicit that the **admin approves**
 * before anything is created, so this only ever returns a proposal — nothing
 * here writes to the database, and the route that calls it does not either.
 *
 * The model's output is treated as a suggestion from an untrusted source: every
 * field type is checked against the engine's own list, every key is slugified,
 * and anything unrecognised is dropped with a note rather than stored.
 */

export type SchemaProposal =
  | {
      ok: true;
      objects: Array<{
        key: string;
        name: string;
        pluralName: string;
        description: string;
        titleField: string | null;
        fields: FieldDefinition[];
      }>;
      /** What was discarded from the model's answer, and why. */
      dropped: string[];
      model: string;
    }
  | { ok: false; error: string };

const SYSTEM = `You design data schemas for a business calling platform.
Given a business description, propose the objects that business sells or manages, and the fields an AI phone agent would need to answer questions and take bookings.

Reply with JSON only, no prose:
{"objects":[{"key":"snake_case","name":"Singular name","plural_name":"Plural name","description":"one line","title_field":"key_of_the_naming_field","fields":[{"key":"snake_case","label":"Human label","type":"one of the allowed types","required":true|false,"filterable":true|false,"options":["only for select"],"related_object":"only for relation","currency":"only for currency, e.g. INR"}]}]}

Allowed types: ${FIELD_TYPE_LIST.join(', ')}.
Rules:
- At most 4 objects and 20 fields each. Fewer, well-chosen fields beat many.
- Mark a field filterable only if a caller would narrow by it ("under 50 lakh", "in Baner", "3BHK"). These types cannot be filtered: ${FIELD_TYPE_LIST.filter((type) => FIELD_TYPES[type].storage === 'none').join(', ')}.
- Use currency for money and inventory for a count of sellable units.
- Use relation to link one object to another, with related_object set to that object's key.
- title_field must be the key of a text field in the same object.
- Never invent regulatory identifiers, prices or stock figures. Fields only, no data.`;

export async function proposeSchema(input: {
  organizationId: string;
  description: string;
}): Promise<SchemaProposal> {
  let raw: { text: string; model: string };
  try {
    const result = await reasonWithTools({
      organizationId: input.organizationId,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Business description:\n${input.description.slice(0, 2000)}`,
        },
      ],
      maxTokens: 2000,
    });
    // The adapter returns provider-shaped content blocks, the same shape the
    // post-call intelligence job reads.
    const blocks = ((result as { content?: unknown[] }).content ??
      []) as Array<{
      type?: string;
      text?: string;
    }>;
    const meta = result as unknown as { model?: unknown };
    raw = {
      text: blocks
        .filter(
          (block) => block.type === 'text' && typeof block.text === 'string',
        )
        .map((block) => block.text as string)
        .join('')
        .trim(),
      model: typeof meta.model === 'string' ? meta.model : 'unknown',
    };
  } catch (error) {
    return {
      ok: false,
      error: `No reasoning provider answered, so no schema was proposed (${error instanceof Error ? error.message : 'unknown error'}).`,
    };
  }

  const parsed = extractJson(raw.text);
  if (!parsed)
    return {
      ok: false,
      error: 'The model did not return a schema this engine could read.',
    };

  // Only real strings are read out of the model's answer; anything else is a
  // malformed proposal, not a value to stringify.
  const str = (value: unknown) => (typeof value === 'string' ? value : '');
  const dropped: string[] = [];
  const objects: Extract<SchemaProposal, { ok: true }>['objects'] = [];
  const rawObjects = Array.isArray(parsed.objects) ? parsed.objects : [];

  for (const entry of rawObjects.slice(0, 4)) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const name = str(item.name).trim().slice(0, 60);
    if (!name) {
      dropped.push('an object with no name');
      continue;
    }
    const key = slugifyKey(str(item.key) || name, 'object');
    const fields: FieldDefinition[] = [];
    const seen = new Set<string>();
    const rawFields = Array.isArray(item.fields) ? item.fields : [];

    for (const fieldEntry of rawFields.slice(0, 20)) {
      if (!fieldEntry || typeof fieldEntry !== 'object') continue;
      const field = fieldEntry as Record<string, unknown>;
      const label = str(field.label).trim().slice(0, 60);
      const type = field.type;
      if (!label) {
        dropped.push(`a field of ${name} with no label`);
        continue;
      }
      if (!isFieldType(type)) {
        dropped.push(
          `${name}.${label}: unknown type "${str(field.type) || 'missing'}"`,
        );
        continue;
      }
      const base = slugifyKey(str(field.key) || label);
      let fieldKey = base;
      let suffix = 2;
      while (seen.has(fieldKey)) fieldKey = `${base}_${suffix++}`;
      seen.add(fieldKey);
      fields.push({
        key: fieldKey,
        label,
        type,
        required: field.required === true,
        // The model is told which types cannot be filtered; this enforces it
        // rather than trusting that it listened.
        filterable:
          field.filterable === true && FIELD_TYPES[type].storage !== 'none',
        options: Array.isArray(field.options)
          ? field.options
              .map((option) => String(option).trim())
              .filter(Boolean)
              .slice(0, 40)
          : [],
        relatedObject: str(field.related_object)
          ? slugifyKey(str(field.related_object))
          : null,
        currency: str(field.currency).trim().slice(0, 8) || null,
      });
    }

    if (!fields.length) {
      dropped.push(`${name}: no usable fields`);
      continue;
    }
    const proposedTitle = str(item.title_field);
    const titleField =
      fields.find((field) => field.key === slugifyKey(proposedTitle))?.key ??
      fields.find((field) => field.type === 'text')?.key ??
      null;
    objects.push({
      key,
      name,
      pluralName: str(item.plural_name).trim().slice(0, 60) || `${name}s`,
      description: str(item.description).trim().slice(0, 300),
      titleField,
      fields,
    });
  }

  if (!objects.length)
    return {
      ok: false,
      error:
        'Nothing usable came back; try describing the business more concretely.',
    };
  return { ok: true, objects, dropped, model: raw.model };
}

/** The model is asked for bare JSON; this survives it wrapping the answer anyway. */
function extractJson(text: string): { objects?: unknown } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as { objects?: unknown })
      : null;
  } catch {
    return null;
  }
}
