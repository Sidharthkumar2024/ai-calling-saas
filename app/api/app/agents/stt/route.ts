import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import {
  ProviderConfigurationError,
  transcribeSpeech,
} from '@/lib/provider-adapters';
import { enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// Server-side speech-to-text so Hindi / Punjabi / Haryanvi / English are
// transcribed accurately by Sarvam instead of the browser's unreliable Web
// Speech API. Falls back (409 + fallback flag) to browser recognition when no
// transcription engine is connected.
export async function POST(request: Request) {
  // Transcription spends provider credits against the workspace.
  const auth = await requireCustomerPermission(request, 'agents.manage');
  if (auth.response) return auth.response;
  const limit = await enforceRateLimit({
    namespace: 'agent-stt',
    identifier: auth.session.userId,
    limit: 90,
    windowSeconds: 60,
  });
  if (!limit.allowed)
    return NextResponse.json(
      { error: 'Voice rate limit reached.' },
      { status: 429 },
    );

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Audio upload is required.' },
      { status: 400 },
    );
  }
  const audio = form.get('audio');
  const agentIdRaw = form.get('agentId');
  const agentId = typeof agentIdRaw === 'string' ? agentIdRaw : '';
  if (!(audio instanceof Blob) || !agentId)
    return NextResponse.json(
      { error: 'Agent and audio are required.' },
      { status: 400 },
    );
  if (audio.size < 800 || audio.size > 8_000_000)
    return NextResponse.json(
      { error: 'Audio length is out of range.' },
      { status: 400 },
    );

  const agent = await getRawDb()
    .prepare(
      `SELECT primary_language FROM voice_agents
       WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(agentId, auth.session.organizationId)
    .first<{ primary_language: string }>();
  if (!agent)
    return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });

  try {
    const result = await transcribeSpeech({
      organizationId: auth.session.organizationId!,
      audio: await audio.arrayBuffer(),
      contentType: audio.type || 'audio/webm',
      // Auto-detect so a caller can switch language mid-conversation.
      languageCode: 'unknown',
    });
    return NextResponse.json({
      transcript: result.transcript,
      languageCode: result.languageCode,
      latencyMs: result.latencyMs,
      provider: result.provider,
      mode: 'connected',
    });
  } catch (error) {
    if (error instanceof ProviderConfigurationError)
      return NextResponse.json(
        { error: error.message, fallback: 'browser' },
        { status: 409 },
      );
    console.error('Speech-to-text failed.', error);
    return NextResponse.json(
      { error: 'Speech-to-text failed.', fallback: 'browser' },
      { status: 502 },
    );
  }
}
