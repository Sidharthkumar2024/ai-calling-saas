'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw, Send, Trash2, Upload } from 'lucide-react';

import {
  FLOW_FIELD_TYPES,
  describeFlowStatus,
  isChoice,
  validateFlow,
  type FlowField,
  type FlowFieldType,
  type FlowScreen,
  type FlowStatus,
} from '@/lib/whatsapp-flows';

/**
 * WhatsApp Flows.
 *
 * A form the customer fills in without leaving WhatsApp — the third way to
 * reach somebody here, after a typed reply inside the 24-hour window and an
 * approved template outside it. Six back-and-forth questions each risk being
 * abandoned halfway; one form comes back in one piece.
 *
 * Only static flows: the whole form is answered on the customer's phone and
 * the answers arrive together. A dynamic flow, where each screen calls this
 * server for the next one, is not built — and this screen never offers it,
 * because a half-built endpoint leaves a customer looking at a screen that
 * never loads.
 */

type Flow = {
  id: string;
  name: string;
  cta_label: string;
  screens: FlowScreen[];
  status: string;
  provider_id: string | null;
  error: string | null;
  published_at: string | null;
};

type FlowResponse = {
  id: string;
  flow_name: string | null;
  phone: string;
  status: string;
  answers: Record<string, string>;
  sent_at: string;
  answered_at: string | null;
};

const BLANK_FIELD = (): FlowField => ({
  name: '',
  label: '',
  type: 'text',
  required: true,
  options: [],
});

const BLANK_SCREEN = (index: number): FlowScreen => ({
  id: index === 0 ? 'DETAILS' : `SCREEN_${index + 1}`,
  title: '',
  fields: [BLANK_FIELD()],
});

export function CustomerWhatsAppFlows() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [responses, setResponses] = useState<FlowResponse[]>([]);
  const [manageable, setManageable] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [cta, setCta] = useState('Open form');
  const [screens, setScreens] = useState<FlowScreen[]>([BLANK_SCREEN(0)]);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/app/whatsapp-flows', {
        cache: 'no-store',
      });
      const body = (await response.json()) as {
        flows?: Flow[];
        responses?: FlowResponse[];
        manageable?: boolean;
        reason?: string | null;
        error?: string;
      };
      if (!response.ok) {
        setNotice(body.error ?? 'Could not load the forms.');
        return;
      }
      setFlows(body.flows ?? []);
      setResponses(body.responses ?? []);
      setManageable(body.manageable === true);
      setReason(body.reason ?? null);
    } catch {
      setNotice('Could not load the forms.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function post(payload: Record<string, unknown>, label: string) {
    setBusy(label);
    setNotice('');
    try {
      const response = await fetch('/api/app/whatsapp-flows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as {
        error?: string;
        note?: string;
        updated?: number;
        unknown?: number;
      };
      if (!response.ok) {
        setNotice(body.error ?? 'That did not work.');
        return false;
      }
      if (typeof body.updated === 'number')
        setNotice(
          `Read back from Meta: ${body.updated} updated${
            body.unknown
              ? `, ${body.unknown} at Meta that this workspace did not create`
              : ''
          }.`,
        );
      else if (body.note) setNotice(body.note);
      await load();
      return true;
    } catch {
      setNotice('That did not work.');
      return false;
    } finally {
      setBusy('');
    }
  }

  function patchField(
    screenAt: number,
    fieldAt: number,
    patch: Partial<FlowField>,
  ) {
    setScreens((current) =>
      current.map((screen, s) =>
        s !== screenAt
          ? screen
          : {
              ...screen,
              fields: screen.fields.map((field, f) =>
                f === fieldAt ? { ...field, ...patch } : field,
              ),
            },
      ),
    );
  }

  const problems = composing
    ? validateFlow({ name, ctaLabel: cta, screens })
    : [];

  async function save() {
    if (problems.length) {
      setNotice(problems.join(' '));
      return;
    }
    const ok = await post(
      {
        action: editing ? 'update_flow' : 'create_flow',
        id: editing,
        name,
        ctaLabel: cta,
        screens,
      },
      'save',
    );
    if (ok) {
      setComposing(false);
      setEditing(null);
      setName('');
      setCta('Open form');
      setScreens([BLANK_SCREEN(0)]);
    }
  }

  if (loading)
    return (
      <div className="flex items-center gap-2 text-[11px] text-ink-muted">
        <Loader2 className="size-3.5 animate-spin" /> Loading forms…
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            WhatsApp forms
          </h1>
          <p className="mt-1 max-w-2xl text-[11px] text-ink-muted">
            A form the customer fills in without leaving WhatsApp. Six questions
            asked one at a time can be abandoned halfway; a form comes back in
            one piece.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!manageable || busy !== ''}
            onClick={() => void post({ action: 'sync_flows' }, 'sync')}
            className="inline-flex items-center gap-2 rounded-xl border border-hairline px-4 py-2 text-sm disabled:opacity-40"
          >
            {busy === 'sync' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Read status from Meta
          </button>
          <button
            type="button"
            onClick={() => {
              setComposing((open) => !open);
              setEditing(null);
              setName('');
              setCta('Open form');
              setScreens([BLANK_SCREEN(0)]);
            }}
            className="portal-primary inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm"
          >
            <Plus className="size-4" /> New form
          </button>
        </div>
      </div>

      {reason ? (
        <p className="rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-[11px] text-ink-body">
          {reason}
        </p>
      ) : null}
      {notice ? (
        <output className="block rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-sm text-ink">
          {notice}
        </output>
      ) : null}

      {composing ? (
        <section className="portal-panel space-y-3 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] text-ink-muted">
              Form name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Site visit request"
                className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink"
              />
            </label>
            <label className="text-[11px] text-ink-muted">
              Button the customer taps
              <input
                value={cta}
                maxLength={20}
                onChange={(event) => setCta(event.target.value)}
                className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink"
              />
            </label>
          </div>

          {screens.map((screen, screenAt) => (
            <div
              key={screen.id + String(screenAt)}
              className="space-y-2 rounded-xl border border-hairline p-3"
            >
              <div className="grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)]">
                <label className="text-[11px] text-ink-muted">
                  Screen id
                  <input
                    value={screen.id}
                    aria-label={`Screen ${screenAt + 1} id`}
                    onChange={(event) =>
                      setScreens((current) =>
                        current.map((entry, s) =>
                          s === screenAt
                            ? { ...entry, id: event.target.value.toUpperCase() }
                            : entry,
                        ),
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 font-mono text-[12px] text-ink"
                  />
                </label>
                <label className="text-[11px] text-ink-muted">
                  Heading the customer reads
                  <input
                    value={screen.title}
                    aria-label={`Screen ${screenAt + 1} heading`}
                    onChange={(event) =>
                      setScreens((current) =>
                        current.map((entry, s) =>
                          s === screenAt
                            ? { ...entry, title: event.target.value }
                            : entry,
                        ),
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink"
                  />
                </label>
              </div>

              {screen.fields.map((field, fieldAt) => (
                <div
                  key={String(fieldAt)}
                  className="grid gap-2 border-t border-hairline pt-2 sm:grid-cols-[minmax(0,1fr)_140px_120px_auto]"
                >
                  <input
                    value={field.label}
                    placeholder="Question the customer reads"
                    aria-label={`Question ${fieldAt + 1} on screen ${screenAt + 1}`}
                    onChange={(event) =>
                      patchField(screenAt, fieldAt, {
                        label: event.target.value,
                      })
                    }
                    className="rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink"
                  />
                  <input
                    value={field.name}
                    placeholder="saved_as"
                    aria-label={`Answer name ${fieldAt + 1} on screen ${screenAt + 1}`}
                    onChange={(event) =>
                      patchField(screenAt, fieldAt, {
                        name: event.target.value.toLowerCase(),
                      })
                    }
                    className="rounded-lg border border-hairline bg-surface px-2 py-1.5 font-mono text-[12px] text-ink"
                  />
                  <select
                    value={field.type}
                    aria-label={`Kind of question ${fieldAt + 1} on screen ${screenAt + 1}`}
                    onChange={(event) =>
                      patchField(screenAt, fieldAt, {
                        type: event.target.value as FlowFieldType,
                      })
                    }
                    className="rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink"
                  >
                    {FLOW_FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(event) =>
                          patchField(screenAt, fieldAt, {
                            required: event.target.checked,
                          })
                        }
                      />
                      Required
                    </label>
                    {screen.fields.length > 1 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setScreens((current) =>
                            current.map((entry, s) =>
                              s === screenAt
                                ? {
                                    ...entry,
                                    fields: entry.fields.filter(
                                      (_, f) => f !== fieldAt,
                                    ),
                                  }
                                : entry,
                            ),
                          )
                        }
                        className="text-[11px] text-danger-text"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  {/* The choices are the only answers Meta will accept, so
                      they are written here rather than left to the customer. */}
                  {isChoice(field.type) ? (
                    <label className="text-[11px] text-ink-muted sm:col-span-4">
                      Choices, one per line
                      <textarea
                        rows={2}
                        value={(field.options ?? []).join('\n')}
                        aria-label={`Choices for question ${fieldAt + 1} on screen ${screenAt + 1}`}
                        onChange={(event) =>
                          patchField(screenAt, fieldAt, {
                            options: event.target.value.split('\n'),
                          })
                        }
                        className="mt-1 w-full resize-y rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink"
                      />
                    </label>
                  ) : null}
                </div>
              ))}

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={screen.fields.length >= 12}
                  onClick={() =>
                    setScreens((current) =>
                      current.map((entry, s) =>
                        s === screenAt
                          ? {
                              ...entry,
                              fields: [...entry.fields, BLANK_FIELD()],
                            }
                          : entry,
                      ),
                    )
                  }
                  className="rounded-lg border border-hairline px-3 py-1.5 text-[11px] disabled:opacity-40"
                >
                  Add a question
                </button>
                {screens.length > 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setScreens((current) =>
                        current.filter((_, s) => s !== screenAt),
                      )
                    }
                    className="rounded-lg border border-hairline px-3 py-1.5 text-[11px] text-danger-text"
                  >
                    Remove screen
                  </button>
                ) : null}
              </div>
            </div>
          ))}

          <button
            type="button"
            disabled={screens.length >= 8}
            onClick={() =>
              setScreens((current) => [
                ...current,
                BLANK_SCREEN(current.length),
              ])
            }
            className="rounded-lg border border-hairline px-3 py-1.5 text-[11px] disabled:opacity-40"
          >
            Add a screen
          </button>

          {problems.length ? (
            <ul className="space-y-1 text-[11px] text-warning-text">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-ink-muted">
              Ready. Save it, send it to Meta, then publish it before it can be
              sent to anybody.
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={problems.length > 0 || busy !== ''}
              onClick={() => void save()}
              className="portal-primary rounded-lg px-3 py-1.5 text-[11px] disabled:opacity-40"
            >
              {editing ? 'Save changes' : 'Create form'}
            </button>
            <button
              type="button"
              onClick={() => {
                setComposing(false);
                setEditing(null);
              }}
              className="rounded-lg border border-hairline px-3 py-1.5 text-[11px]"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      <section className="portal-panel space-y-2 p-5">
        {flows.length === 0 ? (
          <p className="text-[11px] text-ink-muted">
            No forms yet. Build one, send it to Meta, publish it, and it becomes
            available in the inbox.
          </p>
        ) : null}
        {flows.map((flow) => (
          <article
            key={flow.id}
            className="rounded-xl border border-hairline p-3.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-medium">{flow.name}</span>
              <span className="text-[11px] text-ink-muted">
                {flow.screens.length} screen
                {flow.screens.length === 1 ? '' : 's'} ·{' '}
                {flow.screens.reduce((sum, s) => sum + s.fields.length, 0)}{' '}
                questions
              </span>
              <span
                className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${
                  flow.status === 'PUBLISHED'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-surface-muted text-ink-muted'
                }`}
              >
                {flow.status === 'draft' ? 'Draft (here)' : flow.status}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-muted">
              {describeFlowStatus({
                ...flow,
                status: flow.status as FlowStatus,
              })}
            </p>
            {/* Meta's validation errors name the screen and the component.
                Kept verbatim, they point at the thing to fix. */}
            {flow.error ? (
              <p className="mt-1.5 text-[11px] text-warning-text">
                {flow.error}
              </p>
            ) : null}
            <div className="mt-2.5 flex flex-wrap gap-2">
              {!flow.provider_id ? (
                <>
                  <button
                    type="button"
                    disabled={!manageable || busy !== ''}
                    onClick={() =>
                      void post(
                        { action: 'send_to_meta', id: flow.id },
                        `meta_${flow.id}`,
                      )
                    }
                    className="portal-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] disabled:opacity-40"
                  >
                    {busy === `meta_${flow.id}` ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Upload className="size-3.5" />
                    )}
                    Send to Meta
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(flow.id);
                      setComposing(true);
                      setName(flow.name);
                      setCta(flow.cta_label);
                      setScreens(flow.screens);
                    }}
                    className="rounded-lg border border-hairline px-3 py-1.5 text-[11px]"
                  >
                    Edit
                  </button>
                </>
              ) : null}
              {flow.provider_id && flow.status !== 'PUBLISHED' ? (
                <button
                  type="button"
                  disabled={!manageable || busy !== ''}
                  onClick={() =>
                    void post(
                      { action: 'publish_flow', id: flow.id },
                      `pub_${flow.id}`,
                    )
                  }
                  className="portal-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] disabled:opacity-40"
                >
                  {busy === `pub_${flow.id}` ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                  Publish
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy !== ''}
                onClick={() =>
                  void post(
                    { action: 'delete_flow', id: flow.id },
                    `del_${flow.id}`,
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-3 py-1.5 text-[11px] disabled:opacity-40"
              >
                <Trash2 className="size-3.5" /> Remove from this list
              </button>
            </div>
          </article>
        ))}
      </section>

      <section className="portal-panel space-y-2 p-5">
        <h2 className="text-sm font-semibold">What came back</h2>
        {responses.length === 0 ? (
          <p className="text-[11px] text-ink-muted">
            Nothing yet. Send a published form from the WhatsApp inbox and the
            answers land here.
          </p>
        ) : null}
        {responses.map((response) => (
          <div
            key={response.id}
            className="rounded-xl border border-hairline p-3 text-[11px]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{response.phone}</span>
              <span className="text-ink-muted">
                {response.flow_name ?? 'form no longer listed here'}
              </span>
              <span className="ml-auto text-ink-muted">
                {response.answered_at
                  ? `answered ${response.answered_at}`
                  : `sent ${response.sent_at}, not answered yet`}
              </span>
            </div>
            {Object.keys(response.answers).length ? (
              <dl className="mt-1.5 grid gap-x-3 gap-y-0.5 sm:grid-cols-[160px_minmax(0,1fr)]">
                {Object.entries(response.answers).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="font-mono text-ink-muted">{key}</dt>
                    <dd className="text-ink">{value || '—'}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {/* An answer with no matching send is worth seeing, not hiding: it
                means a form went out that this workspace did not record. */}
            {response.status === 'answered_unmatched' ? (
              <p className="mt-1 text-warning-text">
                This arrived without a matching send.
              </p>
            ) : null}
          </div>
        ))}
      </section>
    </div>
  );
}
