import { getRawDb } from '@/db/index';
import { ensureSchema } from '@/db/bootstrap';
import { validateLeadFields, safeLogo } from '@/lib/lead-form-fields';
import { leadWidgetSource } from '@/lib/lead-widget-source';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ publicKey: string }> }) {
  await ensureSchema();
  const { publicKey } = await params;
  const form = await getRawDb().prepare('SELECT fields_json, settings_json, status FROM lead_forms WHERE public_key = ? LIMIT 1').bind(publicKey).first<{ fields_json: string; settings_json: string; status: string }>();
  const headers = { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (!form || form.status !== 'active') return new Response('/* VANI form is not published. */', { status: 404, headers });
  try {
    const fields = validateLeadFields(JSON.parse(form.fields_json));
    const settings = JSON.parse(form.settings_json);
    settings.logoUrl = safeLogo(settings.logoUrl);
    return new Response(leadWidgetSource({ publicKey, endpoint: `${new URL(request.url).origin}/api/forms/${publicKey}/leads`, fields, settings }), { headers });
  } catch { return new Response('/* Form configuration requires review. */', { status: 422, headers }); }
}
