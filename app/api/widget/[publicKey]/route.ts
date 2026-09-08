import { getRawDb } from '@/db/index';
import { ensureSchema } from '@/db/bootstrap';
import { validateLeadFields, safeLogo } from '@/lib/lead-form-fields';
import { publishedOf, type FormRow } from '@/lib/lead-form-publishing';
import { leadWidgetSource } from '@/lib/lead-widget-source';

export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicKey: string }> },
) {
  await ensureSchema();
  const { publicKey } = await params;
  // The published snapshot, never the draft. Serving the draft is what let an
  // unfinished edit reach a visitor mid-keystroke.
  const form = await getRawDb()
    .prepare(`SELECT status, published_fields_json, published_settings_json,
      published_domains_json, published_version, fields_json, settings_json,
      allowed_domains_json, version
    FROM lead_forms WHERE public_key = ? LIMIT 1`)
    .bind(publicKey)
    .first<FormRow>();
  const headers = {
    'content-type': 'application/javascript; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  const live = form ? publishedOf(form) : null;
  if (!live)
    return new Response('/* VANI form is not published. */', {
      status: 404,
      headers,
    });
  try {
    const fields = validateLeadFields(live.fields);
    const settings = live.settings as Record<string, unknown>;
    settings.logoUrl = safeLogo(settings.logoUrl);
    return new Response(
      leadWidgetSource({
        publicKey,
        endpoint: `${new URL(request.url).origin}/api/forms/${publicKey}/leads`,
        fields,
        settings,
      }),
      { headers },
    );
  } catch {
    return new Response('/* Form configuration requires review. */', {
      status: 422,
      headers,
    });
  }
}
