import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { recordCallTurn } from '@/lib/call-telemetry';
import { buildOpening, parseOpening } from '@/lib/campaign-opening';
import { isOpeningStyle, STYLE_GUIDANCE } from '@/lib/campaign-studio';
import { resolveAgentVoice } from '@/lib/voice-profiles';
import { routeTurn } from '@/lib/llm-router';
import { providerFailureDetail } from '@/lib/provider-http';
import {
  ProviderConfigurationError,
  generateVoiceAgentTurn,
  greetingForLanguage,
  platformProviderSecret,
  synthesizeSpeech,
  transcribeSpeech,
} from '@/lib/provider-adapters';

export const dynamic = 'force-dynamic';

/**
 * One conversational turn for the media gateway.
 *
 * The gateway owns audio transport, codecs, silence detection and barge-in —
 * work that needs a long-lived socket this worker cannot hold. Everything that
 * needs provider keys and tenant state stays here: transcribe, reason with the
 * agent's tools, synthesise, and write the turn to call telemetry.
 *
 * Authenticated with MEDIA_GATEWAY_SECRET, the same shared-secret shape the
 * inbound webhook uses. There is no session: the caller is a service.
 */
export async function POST(request: Request) {
  const secret = process.env.MEDIA_GATEWAY_SECRET;
  if (!secret)
    return NextResponse.json(
      {
        error:
          'Media gateway is not configured: set MEDIA_GATEWAY_SECRET on both this app and the gateway.',
      },
      { status: 503 },
    );
  if (request.headers.get('x-vaani-gateway-secret') !== secret)
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const body = (await request.json()) as TurnRequest;
  const callId = (body.callId ?? '').trim();
  if (!callId)
    return NextResponse.json({ error: 'callId is required.' }, { status: 400 });

  try {
    return await runTurn(body, callId);
  } catch (error) {
    // A configuration problem has a message written for the person who has to
    // fix it — which language needs which engine, and where to connect it.
    // Letting it fall through as a bare 500 gives the gateway a failed call and
    // the operator nothing to act on.
    if (error instanceof ProviderConfigurationError)
      return NextResponse.json({ error: error.message }, { status: 503 });
    console.error('voice turn failed', error);
    const detail = providerFailureDetail(error);
    return NextResponse.json(
      {
        error: detail
          ? `The voice turn could not be completed: ${detail}`
          : 'The voice turn could not be completed.',
      },
      { status: 500 },
    );
  }
}

type TurnRequest = {
  callId?: string;
  audioBase64?: string;
  contentType?: string;
  languageCode?: string;
  /** Set on the first turn so the agent opens instead of answering silence. */
  greeting?: boolean;
};

async function runTurn(body: TurnRequest, callId: string) {
  await ensureSchema();
  const db = getRawDb();
  const call = await db
    .prepare(`SELECT c.id, c.organization_id, c.agent_id, c.status,
        a.name AS agent_name, a.use_case, a.primary_language, a.system_prompt,
        a.max_tokens, a.welcome_message, a.tools_json, o.name AS business_name,
        c.direction, c.from_number, c.to_number, c.campaign_id,
        m.opening_json, m.opening_style, m.variants_json,
        cc.variant_key, l.name AS lead_name, l.product_interest
      FROM call_records c
      LEFT JOIN voice_agents a ON a.id = c.agent_id
      LEFT JOIN campaigns m ON m.id = c.campaign_id
      LEFT JOIN campaign_contacts cc ON cc.campaign_id = c.campaign_id AND cc.lead_id = c.lead_id
      LEFT JOIN leads l ON l.id = c.lead_id
      INNER JOIN organizations o ON o.id = c.organization_id
      WHERE c.id = ? LIMIT 1`)
    .bind(callId)
    .first<{
      id: string;
      organization_id: string;
      agent_id: string | null;
      status: string;
      agent_name: string | null;
      use_case: string | null;
      primary_language: string | null;
      system_prompt: string | null;
      max_tokens: number | null;
      welcome_message: string | null;
      tools_json: string | null;
      business_name: string;
      direction: string;
      from_number: string;
      to_number: string;
      campaign_id: string | null;
      opening_json: string | null;
      opening_style: string | null;
      variants_json: string | null;
      variant_key: string | null;
      lead_name: string | null;
      product_interest: string | null;
    }>();
  if (!call)
    return NextResponse.json({ error: 'Call not found.' }, { status: 404 });
  if (!call.agent_id)
    return NextResponse.json(
      { error: 'This call has no AI agent bound to it.' },
      { status: 409 },
    );

  const organizationId = call.organization_id;
  const language = body.languageCode || call.primary_language || 'hi-IN';
  const voice = await resolveAgentVoice({
    organizationId,
    agentId: call.agent_id,
    languageCode: language,
  });

  // The greeting turn has no caller audio to transcribe.
  if (body.greeting) {
    // Was `call.welcome_message || '<a Hindi sentence>'`, played to every
    // caller whatever language the call was in. The greeting turn never reaches
    // the model, so none of the prompt's language rules applied to it (§11).
    // A campaign may say who it is (§19): the company, a team inside it, an
    // executive it calls on behalf of, or the customer by name. Built only
    // from values that exist — a contact with no name gets the company
    // opening, never "Hello , this is".
    const opening = buildOpening({
      config: parseOpening(safeJson(call.opening_json)),
      businessName: call.business_name,
      agentName: call.agent_name || 'Vaani',
      lead: { name: call.lead_name, productInterest: call.product_interest },
    });
    if (opening.degraded && call.campaign_id)
      await db
        .prepare(
          `UPDATE campaigns SET opening_degraded = opening_degraded + 1 WHERE id = ?`,
        )
        .bind(call.campaign_id)
        .run();

    // How the opening is pitched (Part 2.2). Guidance for the model rather
    // than a fixed script, because the line still has to be rendered in the
    // caller's own language.
    const style = isOpeningStyle(call.opening_style)
      ? call.opening_style
      : 'standard';
    const styled =
      opening.text && style !== 'standard' && style !== 'custom'
        ? `${opening.text} [${STYLE_GUIDANCE[style]}]`
        : opening.text;

    const text = await greetingForLanguage({
      organizationId,
      businessName: call.business_name,
      agentName: call.agent_name || 'Vaani',
      // The campaign's line when it has one, and the agent's own welcome
      // otherwise. Either way it is rendered in the language of the call.
      welcomeMessage: styled ?? call.welcome_message,
      sourceLanguage: call.primary_language,
      languageCode: language,
    });
    const speech = await synthesizeSpeech({
      organizationId,
      text,
      languageCode: language,
      voice,
      outputFormat: 'ulaw_8000',
    });
    await recordCallTurn({
      organizationId,
      callId,
      role: 'agent',
      content: text,
      language,
      latencyMs: speech.latencyMs,
    });
    return NextResponse.json({
      transcript: null,
      replyText: text,
      audioBase64: speech.audioBase64,
      contentType: speech.contentType,
      endCall: false,
      latency: { tts: speech.latencyMs },
    });
  }

  if (!body.audioBase64)
    return NextResponse.json(
      { error: 'audioBase64 is required for a caller turn.' },
      { status: 400 },
    );
  const audio = Uint8Array.from(atob(body.audioBase64), (char) =>
    char.charCodeAt(0),
  ).buffer;

  const heard = await transcribeSpeech({
    organizationId,
    audio,
    contentType: body.contentType || 'audio/wav',
    languageCode: language,
  });
  const transcript = (heard.transcript ?? '').trim();
  if (!transcript)
    // Silence or noise: tell the gateway to keep listening rather than
    // answering something the caller never said.
    return NextResponse.json({
      transcript: '',
      replyText: null,
      audioBase64: null,
      endCall: false,
      keepListening: true,
      latency: { stt: heard.latencyMs },
    });

  await recordCallTurn({
    organizationId,
    callId,
    role: 'customer',
    content: transcript,
    language,
  });

  const history = await db
    .prepare(`SELECT role, content FROM call_turns
      WHERE call_id = ? ORDER BY turn_index DESC LIMIT 10`)
    .bind(callId)
    .all<{ role: string; content: string }>();
  const ordered = (history.results ?? [])
    .reverse()
    .filter((turn) => turn.role === 'agent' || turn.role === 'customer')
    .map((turn) => ({
      role: turn.role === 'agent' ? ('assistant' as const) : ('user' as const),
      content: turn.content,
    }));

  const anthropic = await platformProviderSecret('anthropic');
  const escalationModel =
    typeof (anthropic.config as Record<string, unknown>)?.escalationModel ===
    'string'
      ? ((anthropic.config as Record<string, unknown>)
          .escalationModel as string)
      : null;
  const route = routeTurn({
    message: transcript,
    history: ordered,
    escalationModel,
  });

  const turnIndex = ordered.length;
  const live = await generateVoiceAgentTurn({
    organizationId,
    agentName: call.agent_name ?? 'Vaani',
    businessName: call.business_name,
    useCase: call.use_case ?? undefined,
    language,
    systemPrompt: call.system_prompt ?? '',
    maxTokens: Number(call.max_tokens || 180),
    modelOverride: route.model,
    messages: ordered,
    // The picker's selection now reaches the model instead of being ignored.
    toolSelection: call.tools_json,
    // On an inbound call the caller is `from_number`; on an outbound one it is
    // whoever we dialled. Neither ever reached the prompt, so the model had to
    // guess a phone number for every tool that takes one.
    callerNumber:
      call.direction === 'inbound' ? call.from_number : call.to_number,
    toolContext: {
      organizationId,
      agentId: call.agent_id,
      sessionId: callId,
      turnId: turnIndex,
    },
  });

  // 8 kHz mulaw is exactly what the carrier streams, so the gateway forwards
  // it untouched. Asking for MP3 here would need a decoder it does not have.
  const speech = await synthesizeSpeech({
    organizationId,
    text: live.text,
    languageCode: language,
    voice,
    outputFormat: 'ulaw_8000',
  });
  await recordCallTurn({
    organizationId,
    callId,
    role: 'agent',
    content: live.text,
    language,
    latencyMs: live.latencyMs + speech.latencyMs,
    model: route.model,
    toolCalls: live.toolCalls,
  });

  // A tool may have decided the conversation is over.
  const endCall = (live.toolCalls ?? []).some(
    (call_) => call_.name === 'end_call',
  );
  return NextResponse.json({
    transcript,
    replyText: live.text,
    audioBase64: speech.audioBase64,
    contentType: speech.contentType,
    toolCalls: (live.toolCalls ?? []).map((item) => item.name),
    endCall,
    latency: {
      stt: heard.latencyMs,
      llm: live.latencyMs,
      tts: speech.latencyMs,
    },
  });
}

/** A campaign's opening config, or nothing if the column is empty or broken. */
function safeJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
