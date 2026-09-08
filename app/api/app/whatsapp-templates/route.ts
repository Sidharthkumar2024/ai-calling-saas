import { NextResponse } from 'next/server';
import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireAnyCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import {
  fetchWhatsAppTemplates,
  submitWhatsAppTemplate,
  whatsAppTemplateAccess,
} from '@/lib/commerce';
import {
  bodyFromMeta,
  canSubmit,
  toMetaPayload,
  validateDraft,
  type Template,
} from '@/lib/whatsapp-templates';

export const dynamic = 'force-dynamic';

const SELECT = `SELECT id, name, language, category, header, body, footer, status,
  provider_id, rejected_reason, submitted_at, synced_at, created_at
  FROM whatsapp_templates WHERE organization_id = ? ORDER BY created_at DESC`;

export async function GET(request: Request) {
  const auth = await requireAnyCustomerPermission(request, [
    'crm.manage',
    'support.manage',
  ]);
  if (auth.response) return auth.response;
  await ensureSchema();
  const rows = await getRawDb()
    .prepare(SELECT)
    .bind(auth.session.organizationId)
    .all<Template>();
  // Whether templates can be managed at all is a different question from
  // whether WhatsApp is connected, and the screen needs the difference.
  const access = await whatsAppTemplateAccess(auth.session.organizationId!);
  return NextResponse.json({
    templates: rows.results ?? [],
    manageable: access.ok,
    reason: access.ok ? null : access.reason,
  });
}

export async function POST(request: Request) {
  const auth = await requireAnyCustomerPermission(request, [
    'crm.manage',
    'support.manage',
  ]);
  if (auth.response) return auth.response;
  await ensureSchema();
  const input = (await request.json().catch(() => null)) as {
    action?: unknown;
    id?: unknown;
    name?: unknown;
    language?: unknown;
    category?: unknown;
    header?: unknown;
    body?: unknown;
    footer?: unknown;
    examples?: unknown;
  } | null;
  const db = getRawDb();
  const organizationId = auth.session.organizationId!;
  const action = typeof input?.action === 'string' ? input.action : '';
  const text = (value: unknown) => (typeof value === 'string' ? value : '');

  if (action === 'create_template' || action === 'update_template') {
    const draft = {
      name: text(input?.name).trim().toLowerCase(),
      language: text(input?.language).trim() || 'en',
      category: text(input?.category).trim().toUpperCase() || 'UTILITY',
      header: text(input?.header).trim() || null,
      body: text(input?.body).trim(),
      footer: text(input?.footer).trim() || null,
    };
    // Every reason at once. A review queue that answers in hours is the wrong
    // place to learn that a name had a capital letter in it.
    const problems = validateDraft(draft);
    if (problems.length)
      return NextResponse.json({ error: problems.join(' ') }, { status: 400 });

    if (action === 'update_template') {
      const id = text(input?.id);
      const existing = await db
        .prepare(
          `SELECT id, name, language, category, header, body, footer, status, provider_id, rejected_reason FROM whatsapp_templates WHERE id = ? AND organization_id = ?`,
        )
        .bind(id, organizationId)
        .first<Template>();
      if (!existing)
        return NextResponse.json(
          { error: 'That template is not in this workspace.' },
          { status: 404 },
        );
      // A template with Meta is Meta's copy; editing this row would leave the
      // screen describing something other than what customers receive.
      if (!canSubmit(existing))
        return NextResponse.json(
          {
            error:
              'This template is with Meta. Create a new one instead of editing it.',
          },
          { status: 409 },
        );
      await db
        .prepare(`UPDATE whatsapp_templates
          SET name = ?, language = ?, category = ?, header = ?, body = ?,
              footer = ?, status = 'draft', rejected_reason = NULL
          WHERE id = ? AND organization_id = ?`)
        .bind(
          draft.name,
          draft.language,
          draft.category,
          draft.header,
          draft.body,
          draft.footer,
          id,
          organizationId,
        )
        .run();
      await recordAudit(
        auth.session,
        'whatsapp.template_updated',
        'whatsapp_template',
        id,
        { name: draft.name },
      );
      return NextResponse.json({ ok: true, id });
    }

    const id = `wt_${crypto.randomUUID()}`;
    try {
      await db
        .prepare(`INSERT INTO whatsapp_templates
          (id, organization_id, name, language, category, header, body, footer, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`)
        .bind(
          id,
          organizationId,
          draft.name,
          draft.language,
          draft.category,
          draft.header,
          draft.body,
          draft.footer,
        )
        .run();
    } catch {
      // Meta keys a template by name and language, so two rows with the same
      // pair could never both exist there.
      return NextResponse.json(
        {
          error:
            'A template with that name already exists in this language. Use a different name.',
        },
        { status: 409 },
      );
    }
    await recordAudit(
      auth.session,
      'whatsapp.template_created',
      'whatsapp_template',
      id,
      { name: draft.name, language: draft.language },
    );
    return NextResponse.json({ ok: true, id });
  }

  if (action === 'submit_template') {
    const id = text(input?.id);
    const row = await db
      .prepare(
        `SELECT id, name, language, category, header, body, footer, status, provider_id, rejected_reason FROM whatsapp_templates WHERE id = ? AND organization_id = ?`,
      )
      .bind(id, organizationId)
      .first<Template>();
    if (!row)
      return NextResponse.json(
        { error: 'That template is not in this workspace.' },
        { status: 404 },
      );
    if (!canSubmit(row))
      return NextResponse.json(
        { error: 'This one is already with Meta.' },
        { status: 409 },
      );
    // Not reaching Meta at all is a different failure from Meta refusing, and
    // only the second is something Meta said about this template. Recording
    // the first as a rejection would leave the screen quoting Meta on a
    // submission Meta never saw.
    const access = await whatsAppTemplateAccess(organizationId);
    if (!access.ok)
      return NextResponse.json({ error: access.reason }, { status: 409 });
    const examples = Array.isArray(input?.examples)
      ? (input.examples as unknown[]).map((value) => text(value))
      : [];
    let accepted;
    try {
      accepted = await submitWhatsAppTemplate(
        organizationId,
        toMetaPayload(row, examples),
      );
    } catch (error) {
      // Meta's own words, kept. A rewritten reason is a reason nobody can
      // search for when the same rejection happens again.
      const reason =
        error instanceof Error ? error.message : 'Meta refused the template.';
      await db
        .prepare(
          `UPDATE whatsapp_templates SET rejected_reason = ? WHERE id = ? AND organization_id = ?`,
        )
        .bind(reason, id, organizationId)
        .run();
      return NextResponse.json({ error: reason }, { status: 502 });
    }
    await db
      .prepare(`UPDATE whatsapp_templates
        SET status = ?, provider_id = ?, rejected_reason = NULL,
            submitted_at = CURRENT_TIMESTAMP, synced_at = CURRENT_TIMESTAMP
        WHERE id = ? AND organization_id = ?`)
      .bind(accepted.status, accepted.id, id, organizationId)
      .run();
    await recordAudit(
      auth.session,
      'whatsapp.template_submitted',
      'whatsapp_template',
      id,
      { providerId: accepted.id, status: accepted.status },
    );
    return NextResponse.json({ ok: true, status: accepted.status });
  }

  if (action === 'sync_templates') {
    const access = await whatsAppTemplateAccess(organizationId);
    if (!access.ok)
      return NextResponse.json({ error: access.reason }, { status: 409 });
    let remote;
    try {
      remote = await fetchWhatsAppTemplates(organizationId);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Meta did not return the templates.',
        },
        { status: 502 },
      );
    }
    let updated = 0;
    let added = 0;
    for (const template of remote) {
      // Matched on (name, language) rather than on Meta's id: a template
      // approved in Meta's own console has no row here at all, and a workspace
      // that cannot see those would think it has fewer templates than it has.
      const existing = await db
        .prepare(
          `SELECT id FROM whatsapp_templates WHERE organization_id = ? AND name = ? AND language = ?`,
        )
        .bind(organizationId, template.name, template.language)
        .first<{ id: string }>();
      if (existing) {
        await db
          .prepare(`UPDATE whatsapp_templates
            SET status = ?, provider_id = ?, rejected_reason = ?, synced_at = CURRENT_TIMESTAMP
            WHERE id = ?`)
          .bind(
            template.status,
            template.id,
            template.rejected_reason ?? null,
            existing.id,
          )
          .run();
        updated += 1;
        continue;
      }
      await db
        .prepare(`INSERT INTO whatsapp_templates
          (id, organization_id, name, language, category, header, body, footer,
           status, provider_id, rejected_reason, synced_at)
          VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, CURRENT_TIMESTAMP)`)
        .bind(
          `wt_${crypto.randomUUID()}`,
          organizationId,
          template.name,
          template.language,
          (template.category ?? 'UTILITY').toUpperCase(),
          bodyFromMeta(template.components),
          template.status,
          template.id,
          template.rejected_reason ?? null,
        )
        .run();
      added += 1;
    }
    await recordAudit(
      auth.session,
      'whatsapp.templates_synced',
      'whatsapp_template',
      organizationId,
      { added, updated },
    );
    return NextResponse.json({ ok: true, added, updated });
  }

  if (action === 'delete_template') {
    const id = text(input?.id);
    const row = await db
      .prepare(
        `SELECT id, status FROM whatsapp_templates WHERE id = ? AND organization_id = ?`,
      )
      .bind(id, organizationId)
      .first<{ id: string; status: string }>();
    if (!row)
      return NextResponse.json(
        { error: 'That template is not in this workspace.' },
        { status: 404 },
      );
    // Only the local row is removed. Deleting at Meta is a separate act with
    // its own consequences, and quietly doing it here would be doing something
    // nobody asked for.
    await db
      .prepare(
        `DELETE FROM whatsapp_templates WHERE id = ? AND organization_id = ?`,
      )
      .bind(id, organizationId)
      .run();
    await recordAudit(
      auth.session,
      'whatsapp.template_removed',
      'whatsapp_template',
      id,
      { status: row.status },
    );
    return NextResponse.json({
      ok: true,
      note:
        row.status === 'APPROVED'
          ? 'Removed from this list. The template still exists at Meta.'
          : undefined,
    });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
