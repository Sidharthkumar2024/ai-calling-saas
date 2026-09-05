import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import { listDocuments, reviewDocument } from '@/lib/document-inbox';
import {
  DOCUMENT_STATUSES,
  isDocumentStatus,
  VALIDATION_NOTE,
} from '@/lib/whatsapp-media';

export const dynamic = 'force-dynamic';

/**
 * The Document Inbox (Part 3.3).
 *
 * `crm.manage`, because these are customer documents attached to leads and
 * KYC cases — the same people who work the pipeline review them.
 */
export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'crm.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const status = new URL(request.url).searchParams.get('status') ?? '';
  return NextResponse.json({
    documents: await listDocuments({
      organizationId: auth.session.organizationId!,
      status,
    }),
    statuses: DOCUMENT_STATUSES,
    // Carried to the screen rather than left implicit: somebody about to open
    // a stranger's PDF should know exactly what was checked and what was not.
    validationNote: VALIDATION_NOTE,
  });
}

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'crm.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = (await request.json()) as {
    documentId?: string;
    status?: string;
    documentType?: string;
  };
  if (!isDocumentStatus(body.status))
    return NextResponse.json({ error: 'Unknown status.' }, { status: 400 });
  const result = await reviewDocument({
    organizationId: auth.session.organizationId!,
    documentId: String(body.documentId ?? ''),
    status: body.status,
    documentType: body.documentType,
    userId: auth.session.userId,
  });
  if (result.ok)
    await recordAudit(
      auth.session,
      `document.${body.status}`,
      'document_inbox',
      String(body.documentId),
      { documentType: body.documentType ?? null },
    );
  // A refused transition is a 200 carrying the reason — "accepted is terminal"
  // is an answer, not a server error.
  return NextResponse.json(result);
}
