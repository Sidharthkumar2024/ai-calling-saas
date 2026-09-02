import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import {
  ProviderConfigurationError,
  synthesizeSpeech,
} from '@/lib/provider-adapters';
import { enforceRateLimit } from '@/lib/rate-limit';
import { resolveAgentVoice } from '@/lib/voice-profiles';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const limit = await enforceRateLimit({
    namespace: 'agent-speech',
    identifier: auth.session.userId,
    limit: 60,
    windowSeconds: 60,
  });
  if (!limit.allowed)
    return NextResponse.json(
      { error: 'Voice rate limit reached.' },
      { status: 429 },
    );
  const body = (await request.json()) as { agentId?: string; text?: string };
  const text = body.text?.trim();
  if (!body.agentId || !text || text.length > 1200)
    return NextResponse.json(
      { error: 'Agent and spoken text are required.' },
      { status: 400 },
    );
  const agent = await getRawDb()
    .prepare(`SELECT primary_language, voice_name FROM voice_agents
    WHERE id = ? AND organization_id = ? LIMIT 1`)
    .bind(body.agentId, auth.session.organizationId)
    .first<{ primary_language: string; voice_name: string }>();
  if (!agent)
    return NextResponse.json({ error: 'Agent not found.' }, { status: 404 });
  try {
    const languageCode = normalizeLanguage(agent.primary_language);
    // Voice Profile Engine: honour the agent's selected persona, voice lock and
    // same-presentation fallback for this language.
    const voice = await resolveAgentVoice({
      organizationId: auth.session.organizationId!,
      agentId: body.agentId,
      languageCode,
    });
    const speech = await synthesizeSpeech({
      organizationId: auth.session.organizationId!,
      text,
      languageCode,
      speaker: speakerFor(agent.voice_name),
      voice,
    });
    return new Response(base64Bytes(speech.audioBase64), {
      headers: {
        'content-type': speech.contentType,
        'cache-control': 'no-store',
        'x-vaani-voice-mode': 'connected',
        'x-vaani-tts-latency-ms': String(speech.latencyMs),
      },
    });
  } catch (error) {
    if (error instanceof ProviderConfigurationError) {
      return NextResponse.json(
        { error: error.message, fallback: 'browser' },
        { status: 409 },
      );
    }
    console.error('Voice synthesis failed.', error);
    return NextResponse.json(
      { error: 'Connected voice synthesis failed.', fallback: 'browser' },
      { status: 502 },
    );
  }
}

function normalizeLanguage(value: string) {
  return value === 'hinglish' || value === 'haryanvi'
    ? 'hi-IN'
    : value || 'hi-IN';
}
function speakerFor(value: string) {
  return value.includes('Kabir') || value.includes('Arjun') ? 'shubh' : 'priya';
}
function base64Bytes(value: string) {
  const raw = atob(value);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}
