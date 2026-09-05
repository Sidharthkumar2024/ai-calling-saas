import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import {
  associateDocument,
  associationTargets,
  listDocuments,
  reviewDocument,
} from '@/lib/document-inbox';
import {
  ASSOCIATION_KINDS,
  DOCUMENT_STATUSES,
  isAssociationKind,
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
  const params = new URL(request.url).searchParams;
  // The picker asks for candidates one kind at a time.
  const kind = params.get('targets');
  if (kind) {
    if (!isAssociationKind(kind))
      return NextResponse.json({ error: 'Unknown kind.' }, { status: 400 });
    return NextResponse.json({
      targets: await associationTargets({
        organizationId: auth.session.organizationId!,
        kind,
        search: params.get('search') ?? '',
      }),
    });
  }
  const status = params.get('status') ?? '';
  return NextResponse.json({
    documents: await listDocuments({
      organizationId: auth.session.organizationId!,
      status,
    }),
    statuses: DOCUMENT_STATUSES,
    associationKinds: ASSOCIATION_KINDS,
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
    action?: string;
    documentId?: string;
    status?: string;
    documentType?: string;
    kind?: string | null;
    targetId?: string | null;
  };

  if (body.action === 'associate') {
    const result = await associateDocument({
      organizationId: auth.session.organizationId!,
      documentId: String(body.documentId ?? ''),
      kind: body.kind ?? null,
      targetId: body.targetId ?? null,
    });
    if (result.ok)
      await recordAudit(
        auth.session,
        'document.associated',
        'document_inbox',
        String(body.documentId),
        { kind: body.kind ?? null, targetId: body.targetId ?? null },
      );
    // A refusal is a 200 with the reason: "that order is not in this
    // workspace" is an answer, not a server error.
    return NextResponse.json(result);
  }

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
