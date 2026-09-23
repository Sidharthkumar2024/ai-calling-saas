import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { TERMINAL_SQL_LIST } from '@/lib/telephony-status';
import { vobizWorkspaceCredentials } from '@/lib/provider-adapters';
import {
  verifyVobizSignature,
  vobizPublicCallbackUrl,
  vobizStreamXml,
} from '@/lib/vobiz';

export const dynamic = 'force-dynamic';

/**
 * What Vobiz asks for the moment the call is answered.
 *
 * Their platform fetches this URL and does whatever the XML says, so this is
 * where a Vaani call becomes a conversation: the document returned points them
 * at the media gateway and the agent takes over from there.
 *
 * **Why the call id is in the path.** Their signature covers the callback URL
 * with every query parameter stripped — their words: it covers the URL and a
 * nonce, never the request body. A call id in the query would therefore be the
 * one part of this request nothing vouches for, and swapping it would hand the
 * caller another workspace's stream. In the path it is signed, and the token
 * that signs it is the workspace's own.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ callId: string }> },
) {
  await ensureSchema();
  const { callId } = await context.params;
  const db = getRawDb();
  const call = await db
    .prepare(
      'SELECT id, organization_id, status FROM call_records WHERE id = ? LIMIT 1',
    )
    .bind(callId)
    .first<{ id: string; organization_id: string; status: string }>();
  // Unknown call, no XML. An answer document returned to a stranger is a free
  // connection to this product's media gateway.
  if (!call)
    return NextResponse.json({ error: 'Call is unknown.' }, { status: 404 });

  const { authToken } = await vobizWorkspaceCredentials(call.organization_id);
  const publicCallbackUrl = vobizPublicCallbackUrl(
    request.url,
    process.env.PUBLIC_BASE_URL,
  );
  const signature = await verifyVobizSignature({
    url: request.url,
    alternateUrls: publicCallbackUrl ? [publicCallbackUrl] : [],
    headers: request.headers,
    authToken,
  });
  if (!signature.ok)
    return NextResponse.json(
      { error: 'Webhook authentication failed.' },
      { status: 401 },
    );

  const streamUrl = process.env.VOICE_STREAM_URL || '';
  if (!streamUrl.startsWith('wss://'))
    return NextResponse.json(
      { error: 'No media gateway is configured.' },
      { status: 503 },
    );
  const gatewaySecret = process.env.MEDIA_GATEWAY_SECRET || '';
  if (!gatewaySecret)
    return NextResponse.json(
      { error: 'No media gateway authentication is configured.' },
      { status: 503 },
    );
  // The gateway is one host for the whole platform, so the call it is carrying
  // has to be named in the URL. Exotel's leg cannot do this — its stream URL is
  // fixed at dial time — which is why the gateway has never been able to say
  // which call a socket belongs to.
  const stream = new URL(streamUrl);
  stream.searchParams.set('callId', call.id);
  stream.searchParams.set('carrier', 'vobiz');
  // Vobiz cannot attach an HTTP Authorization header to its media socket.
  // The gateway therefore authenticates carrier legs with this shared secret
  // on the secure wss:// URL. Omitting it makes the carrier connect and then
  // immediately fail with `rejected_bad_token`, leaving an answered call with
  // no AI audio.
  stream.searchParams.set('token', gatewaySecret);

  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

  // Their platform only fetches this once the call is answered, so the fetch
  // itself is the evidence. Guarded the way the status callback is: a finished
  // call is not put back on the air by a retried answer request.
  await db
    .prepare(`UPDATE call_records SET
      status = CASE WHEN status IN (${TERMINAL_SQL_LIST}) THEN status ELSE 'in_progress' END
      WHERE id = ?`)
    .bind(call.id)
    .run()
    .catch(() => {});

  return new Response(
    vobizStreamXml({
      streamUrl: stream.toString(),
      // Keep Vobiz input aligned with the gateway's telephony codec.
      contentType: 'audio/x-mulaw;rate=8000',
      statusCallbackUrl: publicBaseUrl
        ? `${publicBaseUrl}/api/webhooks/telephony/vobiz/status/${encodeURIComponent(call.id)}`
        : null,
    }),
    {
      headers: {
        'content-type': 'text/xml; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );
}
