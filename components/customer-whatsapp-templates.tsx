'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';

import {
  CATEGORIES,
  canSubmit,
  describeStatus,
  placeholders,
  validateDraft,
  type Template,
} from '@/lib/whatsapp-templates';

/**
 * WhatsApp message templates.
 *
 * The reply window closes 24 hours after a customer's last message, and from
 * then on WhatsApp accepts only a template Meta has approved. The product had
 * exactly one, named in the integration config and used for payment links, so
 * every conversation past its window was simply over.
 *
 * Meta's rules are checked before submitting rather than learned from a
 * rejection hours later, and the status shown is Meta's own — read back from
 * the Graph API rather than assumed from the fact that we sent it.
 */

const BLANK = {
  name: '',
  language: 'en',
  category: 'UTILITY',
  header: '',
  body: '',
  footer: '',
};

export function CustomerWhatsAppTemplates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [manageable, setManageable] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState(BLANK);
  const [editing, setEditing] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/app/whatsapp-templates', {
        cache: 'no-store',
      });
      const body = (await response.json()) as {
        templates?: Template[];
        manageable?: boolean;
        reason?: string | null;
        error?: string;
      };
      if (!response.ok) {
        setNotice(body.error ?? 'Could not load the templates.');
        return;
      }
      setTemplates(body.templates ?? []);
      setManageable(body.manageable === true);
      setReason(body.reason ?? null);
    } catch {
      setNotice('Could not load the templates.');
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
      const response = await fetch('/api/app/whatsapp-templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as {
        error?: string;
        note?: string;
        added?: number;
        updated?: number;
      };
      if (!response.ok) {
        setNotice(body.error ?? 'That did not work.');
        return false;
      }
      if (typeof body.added === 'number')
        setNotice(
          `Read back from Meta: ${body.added} new, ${body.updated} updated.`,
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

  async function save() {
    // Checked here as well as on the server, so a person sees every problem
    // while the words are still in front of them.
    const problems = validateDraft(draft);
    if (problems.length) {
      setNotice(problems.join(' '));
      return;
    }
    const ok = await post(
      {
        action: editing ? 'update_template' : 'create_template',
        id: editing,
        ...draft,
      },
      'save',
    );
    if (ok) {
      setDraft(BLANK);
      setEditing(null);
      setComposing(false);
    }
  }

  if (loading)
    return (
      <div className="flex items-center gap-2 text-[11px] text-ink-muted">
        <Loader2 className="size-3.5 animate-spin" /> Loading templates…
      </div>
    );

  const problems = composing ? validateDraft(draft) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            WhatsApp templates
          </h1>
          <p className="mt-1 max-w-2xl text-[11px] text-ink-muted">
            WhatsApp accepts a message you write yourself only within 24 hours
            of the customer&rsquo;s last one. After that it accepts only a
            template Meta has approved — these.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!manageable || busy !== ''}
            onClick={() => void post({ action: 'sync_templates' }, 'sync')}
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
              setDraft(BLANK);
              setEditing(null);
            }}
            className="portal-primary inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm"
          >
            <Plus className="size-4" /> New template
          </button>
        </div>
      </div>

      {/* Being unable to manage templates is a different sentence from
          WhatsApp being disconnected, and the two have different fixes. */}
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
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-[11px] text-ink-muted">
              Name
              <input
                value={draft.name}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    name: event.target.value.toLowerCase(),
                  })
                }
                placeholder="appointment_reminder"
                className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink"
              />
            </label>
            <label className="text-[11px] text-ink-muted">
              Language
              <input
                value={draft.language}
                onChange={(event) =>
                  setDraft({ ...draft, language: event.target.value })
                }
                placeholder="en or en_US"
                className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink"
              />
            </label>
            <label className="text-[11px] text-ink-muted">
              Category
              <select
                value={draft.category}
                onChange={(event) =>
                  setDraft({ ...draft, category: event.target.value })
                }
                className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink"
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category.charAt(0) + category.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-[11px] text-ink-muted">
            Header (optional)
            <input
              value={draft.header}
              maxLength={60}
              onChange={(event) =>
                setDraft({ ...draft, header: event.target.value })
              }
              className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink"
            />
          </label>
          <label className="block text-[11px] text-ink-muted">
            Message. Use {'{{1}}'}, {'{{2}}'} where a name or a date goes.
            <textarea
              value={draft.body}
              rows={4}
              maxLength={1024}
              onChange={(event) =>
                setDraft({ ...draft, body: event.target.value })
              }
              placeholder="Hello {{1}}, your appointment is on {{2}}. Reply here if you need to change it."
              className="mt-1 w-full resize-y rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink"
            />
          </label>
          <label className="block text-[11px] text-ink-muted">
            Footer (optional)
            <input
              value={draft.footer}
              maxLength={60}
              onChange={(event) =>
                setDraft({ ...draft, footer: event.target.value })
              }
              className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink"
            />
          </label>
          {/* Every reason at once, while the words are still on screen. Meta
              answers in hours, and one problem per round is the failure this
              replaces. */}
          {problems.length ? (
            <ul className="space-y-1 text-[11px] text-warning-text">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-ink-muted">
              {placeholders(draft.body).length} variable
              {placeholders(draft.body).length === 1 ? '' : 's'}. Meta reviews
              this before it can be sent.
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={problems.length > 0 || busy !== ''}
              onClick={() => void save()}
              className="portal-primary rounded-lg px-3 py-1.5 text-[11px] disabled:opacity-40"
            >
              {editing ? 'Save draft' : 'Create draft'}
            </button>
            <button
              type="button"
              onClick={() => {
                setComposing(false);
                setEditing(null);
                setDraft(BLANK);
              }}
              className="rounded-lg border border-hairline px-3 py-1.5 text-[11px]"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      <section className="portal-panel space-y-2 p-5">
        {templates.length === 0 ? (
          <p className="text-[11px] text-ink-muted">
            No templates yet. Write one, submit it, and it becomes available in
            the inbox once Meta approves it.
          </p>
        ) : null}
        {templates.map((template) => (
          <article
            key={template.id}
            className="rounded-xl border border-hairline p-3.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[12px] font-medium">
                {template.name}
              </span>
              <span className="text-[11px] text-ink-muted">
                {template.language} · {template.category}
              </span>
              <span
                className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${
                  template.status === 'APPROVED'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-surface-muted text-ink-muted'
                }`}
              >
                {template.status === 'draft' ? 'Draft' : template.status}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[12px] text-ink">
              {template.body}
            </p>
            <p className="mt-1.5 text-[11px] text-ink-muted">
              {describeStatus(template)}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {canSubmit(template) ? (
                <>
                  <button
                    type="button"
                    disabled={!manageable || busy !== ''}
                    onClick={() =>
                      void post(
                        { action: 'submit_template', id: template.id },
                        `submit_${template.id}`,
                      )
                    }
                    className="portal-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] disabled:opacity-40"
                  >
                    {busy === `submit_${template.id}` ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Send className="size-3.5" />
                    )}
                    Submit to Meta
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(template.id);
                      setComposing(true);
                      setDraft({
                        name: template.name,
                        language: template.language,
                        category: template.category,
                        header: template.header ?? '',
                        body: template.body,
                        footer: template.footer ?? '',
                      });
                    }}
                    className="rounded-lg border border-hairline px-3 py-1.5 text-[11px]"
                  >
                    Edit
                  </button>
                </>
              ) : null}
              <button
                type="button"
                disabled={busy !== ''}
                onClick={() =>
                  void post(
                    { action: 'delete_template', id: template.id },
                    `delete_${template.id}`,
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
    </div>
  );
}
