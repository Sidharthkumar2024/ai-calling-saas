'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useT } from '@/components/locale-provider';

/**
 * Custom objects, and the records in them.
 *
 * The object engine has been complete in the API since it was written — define
 * an object with typed fields, save records against it, search them, apply an
 * industry template — and nothing in the product ever called it. Not one
 * component fetched `/api/app/objects`, so `create_object`, `update_object` and
 * `delete_record` were unreachable and a workspace could not model anything of
 * its own.
 *
 * This is that screen. It stays deliberately close to the API's own shape: the
 * field types come from the server rather than being listed again here, and so
 * do the templates, because a second copy of either would drift the first time
 * one changed.
 */

type Row = Record<string, unknown>;
type FieldType = { type: string; label: string; filterable: boolean };
type Template = {
  key: string;
  name: string;
  industry: string;
  description: string;
  objectCount: number;
};
type ObjectField = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  /**
   * The designer has no box for these three, and the API stores and returns
   * them, so they are carried rather than described: dropping them on the way
   * through is how a select loses its choices.
   */
  filterable?: boolean;
  options?: string[];
  relatedObject?: string | null;
  currency?: string | null;
};
type CustomObject = {
  id: string;
  key: string;
  name: string;
  pluralName?: string;
  description?: string;
  titleField?: string | null;
  fields: ObjectField[];
};

function str(value: unknown, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return value.toString();
  return fallback;
}

export function CustomerObjects() {
  const t = useT();
  const [objects, setObjects] = useState<CustomObject[]>([]);
  const [fieldTypes, setFieldTypes] = useState<FieldType[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [records, setRecords] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/app/objects', { cache: 'no-store' });
      const body = (await response.json()) as {
        objects?: CustomObject[];
        fieldTypes?: FieldType[];
        templates?: Template[];
        error?: string;
      };
      if (!response.ok) {
        setError(body.error ?? 'Could not load objects.');
        return;
      }
      setObjects(body.objects ?? []);
      setFieldTypes(body.fieldTypes ?? []);
      setTemplates(body.templates ?? []);
      setError('');
    } catch {
      setError('Could not load objects.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRecords = useCallback(async (objectKey: string) => {
    const response = await fetch(
      `/api/app/objects?object=${encodeURIComponent(objectKey)}`,
      { cache: 'no-store' },
    );
    const body = (await response.json()) as { records?: Row[] };
    setRecords(body.records ?? []);
  }, []);

  useEffect(() => {
    // Deferred by a zero timeout, the pattern the other screens here use: the
    // first fetch resolves after the first paint rather than setting state
    // inside the effect body and cascading a second render before anything is
    // on screen.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /**
   * Choosing an object loads its records there and then.
   *
   * This was an effect watching `selected`, which meant every selection cost a
   * second render before the fetch even started. The click already knows what
   * was chosen, so it does both.
   */
  function choose(objectKey: string | null) {
    setSelected(objectKey);
    if (objectKey) void loadRecords(objectKey);
    else setRecords([]);
  }

  async function run(payload: Record<string, unknown>, done: string) {
    setBusy(str(payload.action));
    setNotice('');
    try {
      const response = await fetch('/api/app/objects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as {
        error?: string;
        errors?: Array<{ field: string; message: string }>;
      };
      if (!response.ok) {
        // An array of `{field, message}`, which is what the server actually
        // sends. Reading it as an object keyed by field printed
        // "0: [object Object]" — the shape has to be checked, not assumed.
        const detail = Array.isArray(body.errors)
          ? body.errors
              .map((entry) => `${entry.field}: ${entry.message}`)
              .join(' · ')
          : '';
        setNotice(
          [body.error ?? 'That did not go through.', detail]
            .filter(Boolean)
            .join(' — '),
        );
        return false;
      }
      setNotice(done);
      await load();
      if (selected) await loadRecords(selected);
      return true;
    } catch {
      setNotice('That did not go through.');
      return false;
    } finally {
      setBusy('');
    }
  }

  if (loading)
    return (
      <div className="flex items-center gap-2 text-[11px] text-ink-muted">
        <Loader2 className="size-3.5 animate-spin" /> Loading objects…
      </div>
    );

  const current = objects.find((object) => object.key === selected) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {t('screen.objects.title')}
        </h1>
        <p className="mt-1 text-[11px] text-ink-muted">
          {t('screen.objects.description')}
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-[11px] text-danger-text">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-[11px] text-ink">
          {notice}
        </p>
      ) : null}

      <ObjectDesigner
        objects={objects}
        fieldTypes={fieldTypes}
        run={run}
        busy={busy}
      />

      {templates.length ? (
        <section className="portal-panel p-5">
          <h2 className="text-sm font-semibold">Start from a template</h2>
          <p className="mt-1 text-[11px] text-ink-muted">
            Each one creates the objects a trade usually needs. You can change
            every field afterwards.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => (
              <div key={template.key} className="stage-card rounded-xl p-3.5">
                <p className="text-[12px] font-medium">{template.name}</p>
                <p className="mt-1 text-[11px] text-ink-muted">
                  {template.description}
                </p>
                <button
                  type="button"
                  disabled={busy === 'apply_template'}
                  onClick={() =>
                    void run(
                      { action: 'apply_template', templateKey: template.key },
                      `${template.name} applied.`,
                    )
                  }
                  className="mt-2.5 rounded-lg border border-hairline px-2.5 py-1.5 text-[11px] text-ink-body hover:bg-surface-strong disabled:opacity-50"
                >
                  Add {template.objectCount} object
                  {template.objectCount === 1 ? '' : 's'}
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="portal-panel p-5">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-semibold">Your objects</h2>
          <span className="text-[11px] text-ink-muted">
            {objects.length === 0 ? 'none yet' : `${objects.length} defined`}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {objects.map((object) => (
            <button
              key={object.id}
              type="button"
              onClick={() =>
                choose(selected === object.key ? null : object.key)
              }
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${
                selected === object.key
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-hairline text-ink-body hover:bg-surface-strong'
              }`}
            >
              {object.name}
              <span className="ml-1.5 text-ink-muted">
                {object.fields.length} fields
              </span>
            </button>
          ))}
        </div>

        {current ? (
          <RecordTable
            object={current}
            records={records}
            run={run}
            busy={busy}
          />
        ) : null}
      </section>
    </div>
  );
}

/**
 * Defining an object and its fields.
 *
 * The key is derived from the name rather than asked for: it is what the API
 * slugifies anyway, and a second box whose value the server overwrites is a box
 * that lies. Editing an existing object loads it back into the same form, so
 * there is one place a shape is described rather than two.
 */
function ObjectDesigner({
  objects,
  fieldTypes,
  run,
  busy,
}: {
  objects: CustomObject[];
  fieldTypes: FieldType[];
  run: (payload: Record<string, unknown>, done: string) => Promise<boolean>;
  busy: string;
}) {
  const blank = {
    objectKey: '',
    name: '',
    pluralName: '',
    description: '',
    titleField: '',
  };
  const [form, setForm] = useState(blank);
  const [fields, setFields] = useState<ObjectField[]>([
    { key: 'name', label: 'Name', type: 'text', required: true },
  ]);
  // Editing means the workspace already has this object, not merely that a key
  // is filled in: a proposal arrives with a key of its own and has to be
  // created, and sending it as an update would 404 on a thing that does not
  // exist yet.
  const editing = objects.some((object) => object.key === form.objectKey);

  function loadObject(object: CustomObject) {
    setForm({
      objectKey: object.key,
      name: object.name,
      pluralName: str(object.pluralName),
      description: str(object.description),
      titleField: str(object.titleField),
    });
    setFields(
      object.fields.length
        ? object.fields
        : [{ key: 'name', label: 'Name', type: 'text', required: true }],
    );
  }

  function reset() {
    setForm(blank);
    setFields([{ key: 'name', label: 'Name', type: 'text', required: true }]);
  }

  function loadProposal(object: ProposedObject) {
    setForm({
      objectKey: object.key,
      name: object.name,
      pluralName: str(object.pluralName),
      description: str(object.description),
      titleField: str(object.titleField),
    });
    // Whole fields, the way loadObject passes an existing object's through.
    // Mapping out four properties here dropped a select's options, a currency's
    // currency and a relation's target — the parts of a proposal the designer
    // has no box for and the API stores all the same, so a mapped copy would
    // create a select that constrains nothing and read as though the model had
    // never suggested the choices it did.
    setFields(object.fields);
  }

  return (
    <>
      <SchemaProposer onUse={loadProposal} />
      <section className="portal-panel p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {editing ? `Edit ${form.name}` : 'New object'}
          </h2>
          <div className="flex items-center gap-3">
            {objects.map((object) => (
              <button
                key={object.id}
                type="button"
                onClick={() => loadObject(object)}
                className="text-[11px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
              >
                {object.name}
              </button>
            ))}
            {editing ? (
              <button
                type="button"
                onClick={reset}
                className="text-[11px] text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <label className="text-[11px] text-ink-muted">
            Name
            <input
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              placeholder="Property"
              className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-2 text-[11px] text-ink"
            />
          </label>
          <label className="text-[11px] text-ink-muted">
            Plural
            <input
              value={form.pluralName}
              onChange={(event) =>
                setForm({ ...form, pluralName: event.target.value })
              }
              placeholder="Properties"
              className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-2 text-[11px] text-ink"
            />
          </label>
          <label className="text-[11px] text-ink-muted">
            Headline field
            <select
              value={form.titleField}
              onChange={(event) =>
                setForm({ ...form, titleField: event.target.value })
              }
              className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-2 text-[11px] text-ink"
            >
              <option value="">first text field</option>
              {fields.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label || field.key}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Fields
          </p>
          {fields.map((field, index) => (
            <div
              key={index}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface-muted px-3 py-2"
            >
              <input
                value={field.label}
                onChange={(event) => {
                  const next = [...fields];
                  // The key follows the label until someone has saved the
                  // object; changing a key afterwards would orphan the values
                  // already stored under the old one.
                  next[index] = {
                    ...field,
                    label: event.target.value,
                    key: editing
                      ? field.key
                      : event.target.value
                          .toLowerCase()
                          .replaceAll(/[^a-z0-9]+/g, '_')
                          .replace(/^_+|_+$/g, '') || field.key,
                  };
                  setFields(next);
                }}
                placeholder="Field name"
                className="min-w-40 flex-1 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[11px] text-ink"
              />
              <select
                value={field.type}
                onChange={(event) => {
                  const next = [...fields];
                  next[index] = { ...field, type: event.target.value };
                  setFields(next);
                }}
                className="rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[11px] text-ink"
              >
                {fieldTypes.map((type) => (
                  <option key={type.type} value={type.type}>
                    {type.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                <input
                  type="checkbox"
                  checked={Boolean(field.required)}
                  onChange={(event) => {
                    const next = [...fields];
                    next[index] = { ...field, required: event.target.checked };
                    setFields(next);
                  }}
                />
                required
              </label>
              <button
                type="button"
                disabled={fields.length === 1}
                onClick={() =>
                  setFields(fields.filter((_, at) => at !== index))
                }
                className="text-[11px] text-ink-muted hover:text-ink disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setFields([
                ...fields,
                { key: `field_${fields.length + 1}`, label: '', type: 'text' },
              ])
            }
            className="rounded-lg border border-hairline px-2.5 py-1.5 text-[11px] text-ink-body hover:bg-surface-strong"
          >
            Add field
          </button>
        </div>

        <button
          type="button"
          disabled={
            !form.name.trim() ||
            fields.some((field) => !field.label.trim()) ||
            busy.startsWith('create_') ||
            busy.startsWith('update_')
          }
          onClick={() =>
            void run(
              {
                action: editing ? 'update_object' : 'create_object',
                ...form,
                fields,
              },
              editing ? `${form.name} saved.` : `${form.name} created.`,
            ).then((ok) => {
              if (ok && !editing) reset();
            })
          }
          className="portal-primary mt-4 rounded-lg px-4 py-2 text-[11px] disabled:opacity-50"
        >
          {editing ? 'Save object' : 'Create object'}
        </button>
      </section>
    </>
  );
}

type ProposedObject = {
  key: string;
  name: string;
  pluralName: string;
  description: string;
  titleField: string | null;
  fields: ObjectField[];
};

/**
 * Describe the business, read back the objects it implies.
 *
 * The proposal is the whole of what this does: nothing is created here. §7 puts
 * the person in front of the schema before it exists, and the reason is not
 * ceremony — a model that mishears "we rent equipment" builds the wrong object,
 * and an object with records in it is not something you undo by unticking a
 * box. So every proposal goes into the designer below, under the same Create
 * button as one typed by hand.
 */
function SchemaProposer({
  onUse,
}: {
  onUse: (object: ProposedObject) => void;
}) {
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState<{
    objects: ProposedObject[];
    dropped: string[];
    model: string;
  } | null>(null);

  async function propose() {
    setBusy(true);
    setError('');
    setProposal(null);
    try {
      const response = await fetch('/api/app/objects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'propose_schema',
          businessDescription: description,
        }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        objects?: ProposedObject[];
        dropped?: string[];
        model?: string;
      };
      // A proposal that could not be made comes back as 502 with its own
      // sentence — usually that no reasoning provider is connected. Saying
      // "something went wrong" over the top of that would hide the one thing
      // the reader can act on.
      if (!response.ok || body.ok === false) {
        setError(
          typeof body.error === 'string' && body.error.trim()
            ? body.error
            : 'No schema came back.',
        );
        return;
      }
      setProposal({
        objects: body.objects ?? [],
        dropped: body.dropped ?? [],
        model: str(body.model, 'unknown'),
      });
    } catch {
      setError('No schema came back.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="portal-panel p-5">
      <h2 className="text-sm font-semibold">Start from a description</h2>
      <p className="mt-1 text-[11px] text-ink-muted">
        Say what the business sells or manages and this proposes the objects and
        fields an agent would need. Nothing is created — each proposal opens in
        the designer below for you to change and create yourself.
      </p>
      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        aria-label="Business description"
        placeholder="We sell modular kitchens across Pune, mostly to builders."
        className="mt-3 min-h-20 w-full rounded-lg border border-hairline bg-surface px-2.5 py-2 text-[11px] text-ink"
      />
      <button
        type="button"
        disabled={busy || description.trim().length < 20}
        title={
          description.trim().length < 20
            ? 'A sentence or two, so there is something to work from.'
            : 'Propose a schema'
        }
        onClick={() => void propose()}
        className="mt-2 rounded-lg border border-hairline px-3 py-1.5 text-[11px] disabled:opacity-60"
      >
        {busy ? 'Proposing…' : 'Propose a schema'}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-[11px] text-danger-text">
          {error}
        </p>
      ) : null}

      {proposal ? (
        <div className="mt-4 space-y-2">
          <p className="text-[11px] text-ink-muted">
            Proposed by {proposal.model}. Read it before you create it.
          </p>
          {proposal.objects.map((object) => (
            <div
              key={object.key}
              className="rounded-xl border border-hairline bg-surface-muted px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium">{object.name}</span>
                <span className="text-[11px] text-ink-muted">
                  {object.fields.length} field
                  {object.fields.length === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  onClick={() => onUse(object)}
                  className="ml-auto rounded-lg border border-hairline px-2.5 py-1 text-[11px]"
                >
                  Open in the designer
                </button>
              </div>
              {object.description ? (
                <p className="mt-1 text-[11px] text-ink-muted">
                  {object.description}
                </p>
              ) : null}
              <p className="mt-1 text-[11px] text-ink-muted">
                {object.fields
                  .map((field) =>
                    field.options?.length
                      ? `${field.label} (${field.type}: ${field.options.join(', ')})`
                      : `${field.label} (${field.type})`,
                  )
                  .join(', ')}
              </p>
            </div>
          ))}
          {proposal.dropped.length ? (
            // What the model said that this could not use. Dropping it quietly
            // would leave somebody looking for a field that was never going to
            // be there.
            <div className="rounded-xl border border-hairline px-3 py-2.5">
              <p className="text-[11px] font-medium">
                Left out of the proposal
              </p>
              <ul className="mt-1 space-y-0.5">
                {proposal.dropped.map((line) => (
                  <li key={line} className="text-[11px] text-ink-muted">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** The records in one object, and a row for adding another. */
function RecordTable({
  object,
  records,
  run,
  busy,
}: {
  object: CustomObject;
  records: Row[];
  run: (payload: Record<string, unknown>, done: string) => Promise<boolean>;
  busy: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const columns = object.fields.slice(0, 5);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-hairline bg-surface-muted p-3">
        {columns.map((field) => (
          <label key={field.key} className="text-[11px] text-ink-muted">
            {field.label || field.key}
            {field.required ? ' *' : ''}
            <input
              value={values[field.key] ?? ''}
              onChange={(event) =>
                setValues({ ...values, [field.key]: event.target.value })
              }
              className="mt-1 w-40 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[11px] text-ink"
            />
          </label>
        ))}
        <button
          type="button"
          disabled={busy === 'save_record'}
          onClick={() =>
            void run(
              {
                action: 'save_record',
                objectKey: object.key,
                values,
              },
              'Record saved.',
            ).then((ok) => {
              if (ok) setValues({});
            })
          }
          className="portal-primary rounded-lg px-3 py-2 text-[11px] disabled:opacity-50"
        >
          Add {object.name.toLowerCase()}
        </button>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[11px]">
          <thead className="border-y border-hairline text-[11px] uppercase tracking-wide text-ink-muted">
            <tr>
              {columns.map((field) => (
                <th key={field.key} className="px-3 py-2 font-medium">
                  {field.label || field.key}
                </th>
              ))}
              <th className="px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {records.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-3 py-4 text-ink-muted"
                >
                  No {(object.pluralName || object.name).toLowerCase()} yet.
                </td>
              </tr>
            ) : null}
            {records.map((record) => {
              const stored = (record.values ?? {}) as Record<string, unknown>;
              return (
                <tr key={str(record.id)}>
                  {columns.map((field) => (
                    <td key={field.key} className="px-3 py-2.5 text-ink-body">
                      {str(stored[field.key], '—')}
                    </td>
                  ))}
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      disabled={busy === 'delete_record'}
                      onClick={() =>
                        void run(
                          {
                            action: 'delete_record',
                            objectKey: object.key,
                            recordId: str(record.id),
                          },
                          'Record deleted.',
                        )
                      }
                      className="text-ink-muted hover:text-ink disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
