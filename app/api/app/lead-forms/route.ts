import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { recordAudit } from '@/lib/demo-seed';

export const dynamic = 'force-dynamic';

const DEFAULT_FIELDS = [
  { key: 'name', label: 'Name', required: true },
  { key: 'phone', label: 'Phone', required: true },
  { key: 'email', label: 'Email', required: false },
  { key: 'productInterest', label: 'Interested in', required: false },
];

const DEFAULT_SETTINGS = {
  title: 'Let us call you back',
  description: 'Share your details and our AI specialist will call in under a minute.',
  buttonText: 'Request a call',
  successMessage: 'Thanks — your request is in the CRM.',
  placement: 'bottom_right',
  trigger: 'delay',
  delaySeconds: 5,
  frequency: 'once_session',
  animation: 'slide',
  accent: '#9eb0ff',
  background: '#0b0f17',
};

export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const rows = await getRawDb().prepare(`SELECT id, name, public_key, fields_json,
      allowed_domains_json, settings_json, status, version, published_at, updated_at, created_at
    FROM lead_forms WHERE organization_id = ? ORDER BY created_at DESC`)
    .bind(auth.session.organizationId).all<Record<string, unknown>>();
  const origin = new URL(request.url).origin;
  return NextResponse.json({
    forms: rows.results.map((row) => serialize(row, origin)),
    defaults: { fields: DEFAULT_FIELDS, settings: DEFAULT_SETTINGS },
  });
}

export async function POST(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const body = await request.json() as { name?: string };
  const name = clean(body.name, 80) || 'Website callback popup';
  const id = `form_${crypto.randomUUID()}`;
  const publicKey = `form_${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}`;
  await getRawDb().prepare(`INSERT INTO lead_forms
    (id, organization_id, name, public_key, fields_json, allowed_domains_json,
     settings_json, status, version, updated_at)
    VALUES (?, ?, ?, ?, ?, '[]', ?, 'draft', 1, CURRENT_TIMESTAMP)`)
    .bind(id, auth.session.organizationId, name, publicKey,
      JSON.stringify(DEFAULT_FIELDS), JSON.stringify(DEFAULT_SETTINGS)).run();
  await recordAudit(auth.session, 'lead_form.created', 'lead_form', id, { publicKey });
  return NextResponse.json({ id, publicKey }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const body = await request.json() as {
    id?: string;
    action?: 'save' | 'publish' | 'unpublish';
    name?: string;
    allowedDomains?: string[];
    settings?: Record<string, unknown>;
  };
  if (!body.id) return NextResponse.json({ error: 'Form is required.' }, { status: 400 });
  const existing = await getRawDb().prepare(`SELECT id, settings_json FROM lead_forms
    WHERE id = ? AND organization_id = ? LIMIT 1`).bind(body.id, auth.session.organizationId)
    .first<{ id: string; settings_json: string }>();
  if (!existing) return NextResponse.json({ error: 'Form not found.' }, { status: 404 });
  const current = safeObject(existing.settings_json);
  const settings = validateSettings({ ...DEFAULT_SETTINGS, ...current, ...body.settings });
  const domains = (body.allowedDomains ?? []).map(normalizeOrigin).filter(Boolean).slice(0, 20);
  const action = body.action ?? 'save';
  const status = action === 'publish' ? 'active' : action === 'unpublish' ? 'draft' : null;
  const result = await getRawDb().prepare(`UPDATE lead_forms SET name = ?, settings_json = ?,
      allowed_domains_json = ?, status = coalesce(?, status), version = version + 1,
      published_at = CASE WHEN ? = 'active' THEN CURRENT_TIMESTAMP ELSE published_at END,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`)
    .bind(clean(body.name, 80) || 'Website callback popup', JSON.stringify(settings),
      JSON.stringify(domains), status, status, body.id, auth.session.organizationId).run();
  await recordAudit(auth.session, `lead_form.${action}`, 'lead_form', body.id, { domains });
  return NextResponse.json({ updated: Boolean(result.meta.changes), status: status ?? 'unchanged' });
}

function serialize(row: Record<string, unknown>, origin: string) {
  const settings = { ...DEFAULT_SETTINGS, ...safeObject(rowString(row.settings_json, '{}')) };
  const publicKey = rowString(row.public_key);
  return {
    id: rowString(row.id),
    name: rowString(row.name),
    publicKey,
    fields: safeArray(rowString(row.fields_json, '[]')),
    allowedDomains: safeArray(rowString(row.allowed_domains_json, '[]')),
    settings,
    status: rowString(row.status),
    version: Number(row.version ?? 1),
    publishedAt: row.published_at,
    embedScript: `<script async src="${origin}/api/widget/${publicKey}"></script>`,
    endpoint: `${origin}/api/forms/${publicKey}/leads`,
  };
}

function validateSettings(value: Record<string, unknown>) {
  const allowed = <T extends string>(candidate: unknown, values: T[], fallback: T) =>
    values.includes(candidate as T) ? candidate as T : fallback;
  return {
    title: clean(value.title, 80) || DEFAULT_SETTINGS.title,
    description: clean(value.description, 180) || DEFAULT_SETTINGS.description,
    buttonText: clean(value.buttonText, 40) || DEFAULT_SETTINGS.buttonText,
    successMessage: clean(value.successMessage, 120) || DEFAULT_SETTINGS.successMessage,
    placement: allowed(value.placement, ['bottom_right', 'bottom_left', 'center_modal', 'inline'], 'bottom_right'),
    trigger: allowed(value.trigger, ['delay', 'exit_intent', 'manual'], 'delay'),
    delaySeconds: Math.max(0, Math.min(120, Number(value.delaySeconds ?? 5))),
    frequency: allowed(value.frequency, ['every_visit', 'once_session', 'once_7_days'], 'once_session'),
    animation: allowed(value.animation, ['slide', 'fade', 'bounce'], 'slide'),
    accent: color(value.accent, DEFAULT_SETTINGS.accent),
    background: color(value.background, DEFAULT_SETTINGS.background),
  };
}

function safeObject(value: string) {
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
  catch { return {}; }
}
function safeArray(value: string) { try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function clean(value: unknown, max: number) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function color(value: unknown, fallback: string) { const candidate = clean(value, 7); return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback; }
function normalizeOrigin(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try { const url = new URL(value.trim()); return ['http:', 'https:'].includes(url.protocol) ? url.origin : ''; }
  catch { return ''; }
}
function rowString(value: unknown, fallback = '') { return typeof value === 'string' ? value : fallback; }
