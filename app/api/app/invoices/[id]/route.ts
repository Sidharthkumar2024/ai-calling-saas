import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const { id } = await params;
  const invoice = await getRawDb().prepare(`SELECT i.*, o.name AS organization_name
    FROM invoices i INNER JOIN organizations o ON o.id = i.organization_id
    WHERE i.id = ? AND i.organization_id = ? LIMIT 1`).bind(id, auth.session.organizationId)
    .first<Record<string, unknown>>();
  if (!invoice) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  const number = text(invoice.invoice_number, 'invoice');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(number)}</title><style>body{font:14px/1.55 system-ui;color:#151821;max-width:820px;margin:50px auto;padding:0 24px}header{display:flex;justify-content:space-between;border-bottom:2px solid #111827;padding-bottom:24px}h1{font-size:32px;margin:0}.muted{color:#667085}.total{font-size:26px;font-weight:700}table{width:100%;border-collapse:collapse;margin-top:38px}th,td{text-align:left;padding:12px;border-bottom:1px solid #e5e7eb}td:last-child,th:last-child{text-align:right}.summary{margin:32px 0 0 auto;width:320px}.summary div{display:flex;justify-content:space-between;padding:7px 0}</style></head><body><header><div><h1>Vaani</h1><p class="muted">Revenue Voice OS</p></div><div><strong>Tax invoice</strong><p>${escapeHtml(number)}</p><p class="muted">Issued ${escapeHtml(date(invoice.issued_at))}</p></div></header><h2>${escapeHtml(text(invoice.organization_name))}</h2><p class="muted">Status: ${escapeHtml(text(invoice.status).toUpperCase())}</p><table><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody><tr><td>Vaani subscription / credit services</td><td>${money(invoice.subtotal)}</td></tr></tbody></table><div class="summary"><div><span>Subtotal</span><span>${money(invoice.subtotal)}</span></div><div><span>GST</span><span>${money(invoice.tax)}</span></div><div class="total"><span>Total</span><span>${money(invoice.total)}</span></div></div><p class="muted">This invoice was generated from the tenant billing ledger. Payment status is updated only by a signed provider webhook or local sandbox receipt.</p></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-disposition': `attachment; filename="${number.replace(/[^a-z0-9_-]/gi, '_')}.html"`, 'cache-control': 'private, no-store' } });
}

function text(value: unknown, fallback = '') { return typeof value === 'string' ? value : fallback; }
function money(value: unknown) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(value || 0) / 100); }
function date(value: unknown) { const parsed = new Date(text(value)); return Number.isNaN(parsed.valueOf()) ? '—' : parsed.toLocaleDateString('en-IN', { dateStyle: 'long' }); }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character); }
