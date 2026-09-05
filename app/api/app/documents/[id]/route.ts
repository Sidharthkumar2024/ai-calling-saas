import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import { readDocument } from '@/lib/document-inbox';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Streams one stored document to an authorised reviewer.
 *
 * Never a redirect to provider media: that URL expires and needs our token, so
 * handing it to a browser would either fail or leak the token. The bytes come
 * from this workspace's own storage, and the key is checked against the
 * tenant prefix before anything is read.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireCustomerPermission(request, 'crm.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const limit = await enforceRateLimit({
    namespace: 'document-read',
    identifier: auth.session.userId,
    limit: 120,
    windowSeconds: 60,
  });
  if (!limit.allowed)
    return NextResponse.json({ error: 'Too many downloads.' }, { status: 429 });

  const { id } = await context.params;
  const found = await readDocument(auth.session.organizationId!, id);
  if (!found)
    return NextResponse.json(
      { error: 'Document not available.' },
      { status: 404 },
    );

  await recordAudit(auth.session, 'document.viewed', 'document_inbox', id, {});
  const headers = new Headers();
  found.object.writeHttpMetadata(headers);
  headers.set('content-type', found.mimeType || 'application/octet-stream');
  headers.set('cache-control', 'private, max-age=60');
  // Attachment, not inline: a customer-supplied file must not be rendered in
  // the app's own origin where a crafted SVG or HTML could run against it.
  headers.set(
    'content-disposition',
    `attachment; filename="${(found.filename ?? id).replace(/[^\w.-]/g, '_')}"`,
  );
  headers.set('x-content-type-options', 'nosniff');
  return new NextResponse(found.object.body, { headers });
}
