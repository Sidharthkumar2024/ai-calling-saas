import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import {
  acceptUpload,
  resolveUploadToken,
} from '@/lib/document-request-service';
import { ALLOWED_INCOMING, MAX_BYTES } from '@/lib/whatsapp-media';
import { enforceRateLimit, requestFingerprint } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Where a customer sends the document we asked for.
 *
 * Unauthenticated by design, like `/api/deliver/[token]`: the person uploading
 * a PAN card has no account with us and should not need one. The token is the
 * credential, so the row keeps only its hash, the endpoint is rate limited
 * against guessing, and refused files count against the request.
 *
 * The response says as little as it can get away with. A valid token reveals
 * the name of the document being asked for — the customer has to know what to
 * send — and nothing about the workspace, the lead, or the case.
 */

const ACCEPTED = Object.keys(ALLOWED_INCOMING);

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  await ensureSchema();

  const limit = await enforceRateLimit({
    namespace: 'document-upload',
    identifier: requestFingerprint(request),
    limit: 30,
    windowSeconds: 60,
  });
  if (!limit.allowed)
    return NextResponse.json(
      { error: 'Too many attempts. Wait a minute and try again.' },
      { status: 429 },
    );

  const found = await resolveUploadToken(String(token ?? ''));
  // Deliberately the same 404 shape as a token that exists but is unusable is
  // *not* used here — an expired link telling the customer "expired, ask for a
  // new one" is worth more than the little it gives away.
  if (!found)
    return NextResponse.json(
      { error: 'This upload link is not valid. Ask for a new one.' },
      { status: 404 },
    );

  return NextResponse.json({
    document: found.document,
    open: found.state.open,
    reason: found.state.reason,
    message: found.state.message,
    accepted: ACCEPTED,
    maxBytes: MAX_BYTES,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  await ensureSchema();

  const limit = await enforceRateLimit({
    namespace: 'document-upload',
    identifier: requestFingerprint(request),
    limit: 10,
    windowSeconds: 60,
  });
  if (!limit.allowed)
    return NextResponse.json(
      { error: 'Too many attempts. Wait a minute and try again.' },
      { status: 429 },
    );

  let file: File | null = null;
  try {
    const form = await request.formData();
    const entry = form.get('file');
    if (entry instanceof File) file = entry;
  } catch {
    file = null;
  }
  if (!file || file.size === 0)
    return NextResponse.json(
      { error: 'No file was attached.' },
      { status: 400 },
    );

  // The declared size is checked before the body is read into memory. A worker
  // has a small heap and this endpoint is open to anyone holding the URL.
  const ceiling = Math.max(...Object.values(MAX_BYTES));
  if (file.size > ceiling)
    return NextResponse.json(
      {
        error: `That file is larger than the ${Math.round(ceiling / 1024 / 1024)}MB limit.`,
      },
      { status: 413 },
    );

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await acceptUpload({
    token: String(token ?? ''),
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    bytes,
  });

  if (!result.ok)
    return NextResponse.json(
      { error: result.detail, reason: result.reason },
      { status: result.status },
    );

  return NextResponse.json({
    received: true,
    document: result.document,
    note: result.note,
  });
}
