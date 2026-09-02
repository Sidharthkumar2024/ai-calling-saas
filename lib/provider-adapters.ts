import { getRawDb } from '@/db/index';
import {
  executeAgentTool,
  VAANI_AGENT_TOOLS,
  type ToolContext,
} from '@/lib/agent-tools';
import { decryptSecret } from '@/lib/security';
import { sttProviderOrder, type SttProvider } from '@/lib/stt-router';

type StoredConnection = {
  public_config_json: string;
  encrypted_secret: string | null;
};

type SecretBundle = {
  apiKey?: string;
  apiSecret?: string;
  webhookSecret?: string;
  accountSid?: string;
  accessToken?: string;
};

export type ProviderReadiness = {
  adapter: string;
  publicName: string;
  configured: boolean;
  liveCapable: boolean;
  missing: string[];
  mode: 'live' | 'sandbox' | 'disabled';
};

export async function providerReadiness(organizationId?: string | null) {
  // Keys saved from the admin panel count the same as environment variables.
  const platform = await platformSecretMap();
  const platformConfig = (provider: string) =>
    (platform.config.get(provider) ?? {}) as Record<string, unknown>;
  const sarvam =
    Boolean(process.env.SARVAM_API_KEY) || platform.set.has('sarvam');
  const anthropic =
    Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_MODEL) ||
    (platform.set.has('anthropic') &&
      Boolean(configString(platformConfig('anthropic'), 'model')));
  const openai =
    Boolean(process.env.OPENAI_API_KEY) || platform.set.has('openai');
  const elevenlabs =
    Boolean(
      process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID,
    ) ||
    (platform.set.has('elevenlabs') &&
      Boolean(configString(platformConfig('elevenlabs'), 'voiceId')));
  const exotel = Boolean(
    process.env.EXOTEL_ACCOUNT_SID &&
    process.env.EXOTEL_API_KEY &&
    process.env.EXOTEL_API_TOKEN &&
    process.env.EXOTEL_CALLER_ID &&
    process.env.PUBLIC_BASE_URL &&
    process.env.VOICE_STREAM_URL &&
    process.env.TELEPHONY_WEBHOOK_SECRET,
  );
  const whatsapp = Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID,
  );
  const razorpay = Boolean(
    process.env.RAZORPAY_KEY_ID &&
    process.env.RAZORPAY_KEY_SECRET &&
    process.env.RAZORPAY_WEBHOOK_SECRET,
  );
  const stored = organizationId
    ? await getRawDb()
        .prepare(`SELECT type FROM integration_connections
          WHERE organization_id = ? AND encrypted_secret IS NOT NULL`)
        .bind(organizationId)
        .all<{ type: string }>()
    : { results: [] as Array<{ type: string }> };
  const connected = new Set(stored.results.map((item) => item.type));

  return [
    readiness(
      'sarvam',
      'Vaani Voice India',
      sarvam || connected.has('sarvam_voice'),
      ['SARVAM_API_KEY'],
    ),
    readiness(
      'elevenlabs',
      'Vaani Voice Global',
      elevenlabs || connected.has('elevenlabs_voice'),
      ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'],
    ),
    readiness(
      'openai',
      'Vaani Realtime',
      openai || connected.has('openai_platform'),
      ['OPENAI_API_KEY'],
    ),
    readiness(
      'anthropic',
      'Vaani Sense',
      anthropic || connected.has('anthropic_reasoning'),
      ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'],
    ),
    readiness(
      'exotel',
      'Vaani Connect',
      exotel ||
        (connected.has('telephony_exotel') &&
          Boolean(
            process.env.PUBLIC_BASE_URL &&
            process.env.VOICE_STREAM_URL &&
            process.env.TELEPHONY_WEBHOOK_SECRET,
          )),
      [
        'EXOTEL_ACCOUNT_SID',
        'EXOTEL_API_KEY',
        'EXOTEL_API_TOKEN',
        'EXOTEL_CALLER_ID',
        'PUBLIC_BASE_URL',
        'VOICE_STREAM_URL',
        'TELEPHONY_WEBHOOK_SECRET',
      ],
    ),
    readiness(
      'whatsapp',
      'Vaani Messages',
      whatsapp || connected.has('whatsapp_cloud'),
      ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
    ),
    readiness(
      'razorpay',
      'Vaani Payments',
      razorpay || connected.has('razorpay'),
      ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
    ),
  ];
}

export async function synthesizeSpeech(input: {
  organizationId: string;
  text: string;
  languageCode: string;
  speaker?: string;
  /** Resolved voice profile: overrides the platform default for this turn. */
  voice?: {
    provider?: string;
    voiceId?: string | null;
    modelId?: string | null;
    speakingRate?: string;
  } | null;
}) {
  const [credentials, globalVoice, sarvamPlatform, elevenPlatform] =
    await Promise.all([
      connectionCredentials(input.organizationId, 'sarvam_voice'),
      connectionCredentials(input.organizationId, 'elevenlabs_voice'),
      platformProviderSecret('sarvam'),
      platformProviderSecret('elevenlabs'),
    ]);
  const apiKey =
    process.env.SARVAM_API_KEY ||
    sarvamPlatform.apiKey ||
    credentials.secrets.apiKey;
  const elevenLabsApiKey =
    process.env.ELEVENLABS_API_KEY ||
    elevenPlatform.apiKey ||
    globalVoice.secrets.apiKey;
  // Voice profile wins, then admin-panel config (the operator control plane),
  // then environment variables as a bootstrap default.
  const profileVoiceId =
    input.voice?.provider === 'elevenlabs' ? input.voice.voiceId || '' : '';
  const elevenLabsVoiceId =
    profileVoiceId ||
    configString(elevenPlatform.config, 'voiceId') ||
    process.env.ELEVENLABS_VOICE_ID ||
    configString(globalVoice.publicConfig, 'accountId');
  const elevenLabsModelId =
    (input.voice?.provider === 'elevenlabs' ? input.voice.modelId || '' : '') ||
    configString(elevenPlatform.config, 'modelId') ||
    process.env.ELEVENLABS_MODEL_ID ||
    undefined;
  // An explicit Sarvam profile keeps Indian-language pronunciation on Sarvam.
  const prefersSarvamProfile =
    input.voice?.provider === 'sarvam' && Boolean(apiKey);
  const preferGlobalVoice =
    !prefersSarvamProfile &&
    (input.voice?.provider === 'elevenlabs' ||
      input.languageCode === 'en-IN') &&
    Boolean(elevenLabsApiKey && elevenLabsVoiceId);
  if (preferGlobalVoice || (!apiKey && elevenLabsApiKey && elevenLabsVoiceId)) {
    return synthesizeGlobalSpeech({
      ...input,
      apiKey: elevenLabsApiKey!,
      voiceId: elevenLabsVoiceId!,
      modelId: elevenLabsModelId,
    });
  }
  if (!apiKey)
    throw new ProviderConfigurationError('No Vaani voice engine is connected.');
  const started = Date.now();
  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text: input.text.slice(0, 2500),
      language_code: input.languageCode,
      speaker:
        (input.voice?.provider === 'sarvam' ? input.voice.voiceId || '' : '') ||
        input.speaker ||
        'shubh',
      model: 'bulbul:v3',
      output_audio_codec: 'wav',
      speech_sample_rate: 16000,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json()) as {
    request_id?: string;
    audios?: string[];
    error?: { message?: string };
  };
  if (!response.ok || !payload.audios?.[0]) {
    throw new Error(
      payload.error?.message || `Voice synthesis failed (${response.status}).`,
    );
  }
  const latencyMs = Date.now() - started;
  await recordUsage(
    input.organizationId,
    'provider_sarvam',
    'speech',
    'tts',
    latencyMs,
    payload.request_id || null,
  );
  return {
    providerReference: payload.request_id || null,
    audioBase64: payload.audios[0],
    latencyMs,
    contentType: 'audio/wav',
  };
}

export async function transcribeSpeech(input: {
  organizationId: string;
  audio: ArrayBuffer;
  contentType?: string;
  languageCode?: string;
}) {
  const [credentials, platform, elevenPlatform, elevenConnection] =
    await Promise.all([
      connectionCredentials(input.organizationId, 'sarvam_voice'),
      platformProviderSecret('sarvam'),
      platformProviderSecret('elevenlabs'),
      connectionCredentials(input.organizationId, 'elevenlabs_voice'),
    ]);
  const sarvamKey =
    process.env.SARVAM_API_KEY || platform.apiKey || credentials.secrets.apiKey;
  const elevenKey =
    process.env.ELEVENLABS_API_KEY ||
    elevenPlatform.apiKey ||
    elevenConnection.secrets.apiKey;
  if (!sarvamKey && !elevenKey)
    throw new ProviderConfigurationError(
      'No Vaani transcription engine is connected.',
    );
  const sttModelId =
    process.env.ELEVENLABS_STT_MODEL_ID ||
    configString(elevenPlatform.config, 'sttModelId') ||
    'scribe_v1';
  const failures: string[] = [];
  for (const provider of sttProviderOrder(input.languageCode)) {
    try {
      if (provider === 'sarvam' && sarvamKey)
        return {
          ...(await transcribeWithSarvam(input, sarvamKey)),
          provider: 'sarvam' as SttProvider,
        };
      if (provider === 'elevenlabs' && elevenKey)
        return {
          ...(await transcribeWithElevenLabs(input, elevenKey, sttModelId)),
          provider: 'elevenlabs' as SttProvider,
        };
    } catch (error) {
      failures.push(
        `${provider}: ${error instanceof Error ? error.message : 'failed'}`,
      );
    }
  }
  throw new Error(failures.join(' | ') || 'Transcription failed.');
}

async function transcribeWithElevenLabs(
  input: { organizationId: string; audio: ArrayBuffer; contentType?: string },
  apiKey: string,
  modelId: string,
) {
  const started = Date.now();
  const form = new FormData();
  form.append(
    'file',
    new Blob([input.audio], { type: input.contentType || 'audio/webm' }),
    'audio.webm',
  );
  form.append('model_id', modelId);
  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
    signal: AbortSignal.timeout(25_000),
  });
  const raw = await response.text();
  if (!response.ok)
    throw new Error(
      `ElevenLabs STT failed (${response.status}): ${raw.slice(0, 160)}`,
    );
  let payload: { text?: string; language_code?: string } = {};
  try {
    payload = JSON.parse(raw) as { text?: string; language_code?: string };
  } catch {
    throw new Error('ElevenLabs STT returned an unreadable response.');
  }
  if (typeof payload.text !== 'string')
    throw new Error('ElevenLabs STT returned no transcript.');
  const latencyMs = Date.now() - started;
  await recordUsage(
    input.organizationId,
    'provider_elevenlabs',
    'speech',
    'stt',
    latencyMs,
    null,
  );
  return {
    transcript: payload.text.trim(),
    languageCode: payload.language_code || null,
    latencyMs,
  };
}

async function transcribeWithSarvam(
  input: {
    organizationId: string;
    audio: ArrayBuffer;
    contentType?: string;
    languageCode?: string;
  },
  apiKey: string,
) {
  const started = Date.now();
  const form = new FormData();
  form.append(
    'file',
    new Blob([input.audio], { type: input.contentType || 'audio/wav' }),
    'audio.wav',
  );
  form.append('model', 'saarika:v2.5');
  // 'unknown' lets Sarvam auto-detect the spoken language (Hindi, Punjabi,
  // Haryanvi, English, etc.) so the caller can switch languages freely.
  form.append('language_code', input.languageCode || 'unknown');
  const response = await fetch('https://api.sarvam.ai/speech-to-text', {
    method: 'POST',
    headers: { 'api-subscription-key': apiKey },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json()) as {
    request_id?: string;
    transcript?: string;
    language_code?: string;
    error?: { message?: string };
  };
  if (!response.ok || typeof payload.transcript !== 'string')
    throw new Error(
      payload.error?.message || `Transcription failed (${response.status}).`,
    );
  const latencyMs = Date.now() - started;
  await recordUsage(
    input.organizationId,
    'provider_sarvam',
    'speech',
    'stt',
    latencyMs,
    payload.request_id || null,
  );
  return {
    transcript: payload.transcript.trim(),
    languageCode: payload.language_code || null,
    latencyMs,
  };
}

export async function reasonWithTools(input: {
  organizationId: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string | unknown[] }>;
  tools?: Array<Record<string, unknown>>;
  maxTokens?: number;
  /** LLM router override for this turn; falls back to the configured model. */
  model?: string | null;
}) {
  const [openaiCredentials, openaiPlatform] = await Promise.all([
    connectionCredentials(input.organizationId, 'openai_platform'),
    platformProviderSecret('openai'),
  ]);
  const openaiApiKey =
    process.env.OPENAI_API_KEY ||
    openaiPlatform.apiKey ||
    openaiCredentials.secrets.apiKey;
  if (openaiApiKey)
    return reasonWithOpenAI(
      input,
      openaiApiKey,
      configString(openaiPlatform.config, 'model') ||
        configString(openaiCredentials.publicConfig, 'accountId'),
    );
  const [credentials, anthropicPlatform] = await Promise.all([
    connectionCredentials(input.organizationId, 'anthropic_reasoning'),
    platformProviderSecret('anthropic'),
  ]);
  const apiKey =
    process.env.ANTHROPIC_API_KEY ||
    anthropicPlatform.apiKey ||
    credentials.secrets.apiKey;
  const configuredModel =
    process.env.ANTHROPIC_MODEL ||
    configString(anthropicPlatform.config, 'model') ||
    configString(credentials.publicConfig, 'model');
  // The router may ask for a stronger model on this turn only.
  const model = input.model?.trim() || configuredModel;
  if (!apiKey || !model)
    throw new ProviderConfigurationError('Vaani Sense is not connected.');
  const started = Date.now();
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: Math.max(40, Math.min(700, input.maxTokens ?? 700)),
      system: input.system,
      messages: input.messages,
      ...(input.tools?.length ? { tools: input.tools } : {}),
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const payload = (await response.json()) as {
    id?: string;
    content?: unknown[];
    stop_reason?: string;
    error?: { message?: string };
    usage?: unknown;
  };
  if (!response.ok || !payload.id)
    throw new Error(
      payload.error?.message || `Reasoning failed (${response.status}).`,
    );
  const latencyMs = Date.now() - started;
  await recordUsage(
    input.organizationId,
    'provider_anthropic',
    'reasoning',
    'messages',
    latencyMs,
    payload.id,
  );
  return { ...payload, latencyMs };
}

export async function generateVoiceAgentTurn(input: {
  organizationId: string;
  agentName: string;
  businessName: string;
  useCase?: string;
  language: string;
  systemPrompt: string;
  maxTokens: number;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Supplying this enables real business tool calling for the turn. */
  toolContext?: ToolContext;
  /** LLM router decision for this turn. */
  modelOverride?: string | null;
}) {
  const system = buildVoiceAgentInstructions(input);
  const messages: Array<{
    role: 'user' | 'assistant';
    content: string | unknown[];
  }> = input.messages.slice(-10);
  const toolCalls: Array<{
    name: string;
    input: unknown;
    result: unknown;
  }> = [];
  let latencyMs = 0;
  let providerReference: string | null = null;

  // Up to three rounds: the model may look something up, then answer.
  for (let round = 0; round < 3; round += 1) {
    const response = await reasonWithTools({
      organizationId: input.organizationId,
      maxTokens: Math.min(220, input.maxTokens),
      system,
      messages,
      model: input.modelOverride ?? null,
      ...(input.toolContext ? { tools: VAANI_AGENT_TOOLS } : {}),
    });
    latencyMs += response.latencyMs;
    providerReference = response.id || providerReference;
    const blocks = Array.isArray(response.content)
      ? (response.content as Array<Record<string, unknown>>)
      : [];
    const toolUses = blocks.filter((block) => block?.type === 'tool_use');
    const stopReason = (response as { stop_reason?: string }).stop_reason;
    if (!input.toolContext || stopReason !== 'tool_use' || !toolUses.length) {
      const text = extractText(response.content);
      if (!text) throw new Error('Vaani Sense returned no spoken response.');
      return { text, latencyMs, providerReference, toolCalls };
    }
    // Feed the model's own tool_use blocks back, then the real results.
    messages.push({ role: 'assistant', content: blocks });
    const results: unknown[] = [];
    for (const use of toolUses) {
      const name = typeof use.name === 'string' ? use.name : '';
      const args =
        use.input && typeof use.input === 'object'
          ? (use.input as Record<string, unknown>)
          : {};
      const outcome = await executeAgentTool(name, args, input.toolContext);
      toolCalls.push({ name, input: args, result: outcome });
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(outcome),
      });
    }
    messages.push({ role: 'user', content: results });
  }
  // Round limit reached while still calling tools: ask once more without tools
  // so the model has to speak instead of looping.
  const closing = await reasonWithTools({
    organizationId: input.organizationId,
    maxTokens: Math.min(220, input.maxTokens),
    system,
    messages,
    model: input.modelOverride ?? null,
  });
  latencyMs += closing.latencyMs;
  providerReference = closing.id || providerReference;
  const closingText = extractText(closing.content);
  if (!closingText) throw new Error('Vaani Sense returned no spoken response.');
  return { text: closingText, latencyMs, providerReference, toolCalls };
}

export function buildVoiceAgentInstructions(input: {
  agentName: string;
  businessName: string;
  useCase?: string;
  language: string;
  systemPrompt: string;
}) {
  const openingLanguage =
    input.language === 'en-IN'
      ? 'concise natural Indian English'
      : input.language === 'haryanvi'
        ? 'natural, respectful Haryanvi written in Devanagari'
        : input.language === 'hinglish'
          ? 'natural spoken Hinglish (Devanagari for Hindi, English only for common product terms)'
          : `natural ${languageName(input.language)}`;
  const languageRule = `Open the conversation in ${openingLanguage}. After that, always mirror the customer: reply in whichever language they speak or explicitly ask for, including Hindi, Indian English, Hinglish, Punjabi, Haryanvi, Marathi, Gujarati, Bengali, Tamil, Telugu, Kannada, Malayalam, Urdu, Bhojpuri and Rajasthani. If the customer asks you to switch language, switch on that same turn and stay in the new language until they change again. Write every language in its own natural script — Punjabi in Gurmukhi, Hindi/Haryanvi/Marathi in Devanagari, Bengali in Bengali script, Tamil in Tamil script — and keep brand, product and business terms exactly as given. Never claim you can only speak certain languages, and never refuse or deflect a language request.`;
  return `<identity>You are ${input.agentName}, the private voice agent for ${input.businessName}. Never reveal upstream model, voice, transcription or telephony vendors.</identity>
<business_context>Use case: ${input.useCase || 'general customer conversation'}. The customer may sell a physical product, digital product, course, software, service or property. Use only the workspace instructions and approved knowledge; never assume which kind of product it is.</business_context>
<conversation_rules>${languageRule} Speak in one or two short, easily interruptible sentences. Respond as soon as the customer's turn is complete. First answer the customer's actual words naturally, including greetings, jokes and small talk; only then guide gently toward the business goal. Adapt warmth, pace, formality and directness to the customer's speech and sentiment, but never imitate abuse or pressure the customer. Never respond to casual conversation with a menu of options. Ask only one question at a time. Avoid markdown, lists and long explanations.</conversation_rules>
<action_safety>Never say an action succeeded unless a tool result confirms it. You do not decide refunds, approvals or transfers — call the tool and follow its say_to_customer guidance exactly. A refund is "submitted" or "sent for approval", never "done", until a tool result says confirmed. If a transfer tool reports transferred:false, never tell the caller you are connecting them; offer a callback instead. Before sending a payment link, ask whether the calling number is available on WhatsApp. If yes, confirm amount and timing, then use WhatsApp. If not, collect and read back an email address. Never request an OTP, CVV, card PIN, password or full card details. Obtain consent before messaging, booking, transferring or scheduling.</action_safety>
<examples><example customer="क्या हो रहा है?" assistant="बस बढ़िया जी, आपसे बात हो रही है। आप सुनाइए, सब ठीक?"/><example customer="और तेरे के हाल हैं?" assistant="मैं बढ़िया सूँ जी, आप सुनाओ—आपके के हाल हैं?"/><example customer="पंजाबी में बात करो" assistant="ਹਾਂ ਜੀ, ਬਿਲਕੁਲ ਪੰਜਾਬੀ ਵਿੱਚ ਗੱਲ ਕਰਦੇ ਹਾਂ। ਦੱਸੋ, ਮੈਂ ਤੁਹਾਡੀ ਕੀ ਮਦਦ ਕਰਾਂ?"/><example customer="payment link आठ बजे भेज देना" assistant="ठीक है जी। क्या इसी calling number पर WhatsApp चलता है?"/><example customer="इस नंबर पर WhatsApp नहीं है" assistant="कोई बात नहीं। किस email address पर link भेजूँ?"/></examples>
<workspace_instructions>${input.systemPrompt}</workspace_instructions>`;
}

export async function createOpenAIRealtimeCall(input: {
  organizationId: string;
  sdp: string;
  instructions: string;
  maxOutputTokens?: number;
}) {
  const credentials = await connectionCredentials(
    input.organizationId,
    'openai_platform',
  );
  const apiKey = process.env.OPENAI_API_KEY || credentials.secrets.apiKey;
  if (!apiKey)
    throw new ProviderConfigurationError('Vaani Realtime is not connected.');
  const model =
    process.env.OPENAI_REALTIME_MODEL ||
    configString(credentials.publicConfig, 'realtimeModel') ||
    'gpt-realtime-2.1-mini';
  const started = Date.now();
  const response = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sdp: input.sdp,
      session: {
        type: 'realtime',
        model,
        output_modalities: ['audio'],
        instructions: input.instructions,
        max_output_tokens: Math.max(
          40,
          Math.min(320, input.maxOutputTokens ?? 180),
        ),
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const answerSdp = await response.text();
  if (!response.ok || !answerSdp.startsWith('v=')) {
    throw new Error(
      `Realtime connection failed (${response.status}): ${answerSdp.slice(0, 220)}`,
    );
  }
  const latencyMs = Date.now() - started;
  const location = response.headers.get('location');
  await recordUsage(
    input.organizationId,
    'provider_openai',
    'realtime',
    model,
    latencyMs,
    location,
  );
  return { answerSdp, latencyMs, model, location };
}

export async function startOutboundCall(input: {
  organizationId: string;
  callId: string;
  destination: string;
  streamUrl: string;
  timeLimitSeconds?: number;
  recordCall?: boolean;
}) {
  const credentials = await connectionCredentials(
    input.organizationId,
    'telephony_exotel',
  );
  const accountSid =
    process.env.EXOTEL_ACCOUNT_SID ||
    credentials.secrets.accountSid ||
    configString(credentials.publicConfig, 'accountSid');
  const apiKey = process.env.EXOTEL_API_KEY || credentials.secrets.apiKey;
  const apiToken =
    process.env.EXOTEL_API_TOKEN || credentials.secrets.apiSecret;
  const callerId =
    process.env.EXOTEL_CALLER_ID ||
    configString(credentials.publicConfig, 'callerId');
  const cluster =
    process.env.EXOTEL_CLUSTER === 'singapore'
      ? 'api.exotel.com'
      : 'api.in.exotel.com';
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (!accountSid || !apiKey || !apiToken || !callerId || !publicBaseUrl) {
    throw new ProviderConfigurationError(
      'Vaani Connect is not ready for live calls.',
    );
  }
  if (!input.streamUrl.startsWith('wss://'))
    throw new Error('A secure wss:// media stream URL is required.');
  const form = new URLSearchParams();
  form.set('from', input.destination);
  form.set('callerid', callerId);
  form.set('streamurl', input.streamUrl);
  form.set('streamtype', 'bidirectional');
  form.set('record', input.recordCall === false ? 'false' : 'true');
  if (input.recordCall !== false) form.set('recordingchannels', 'dual');
  form.set(
    'timelimit',
    String(Math.min(3600, Math.max(30, input.timeLimitSeconds || 300))),
  );
  form.set('customfield', input.callId);
  const webhookToken = process.env.TELEPHONY_WEBHOOK_SECRET;
  if (!webhookToken)
    throw new ProviderConfigurationError(
      'Telephony webhook secret is not configured.',
    );
  form.set(
    'statuscallback',
    `${publicBaseUrl.replace(/\/$/, '')}/api/webhooks/telephony/exotel?token=${encodeURIComponent(webhookToken)}`,
  );
  form.append('statuscallbackevents[]', 'answered');
  form.append('statuscallbackevents[]', 'terminal');
  const started = Date.now();
  const response = await fetch(
    `https://${cluster}/v1/accounts/${encodeURIComponent(accountSid)}/calls/connect`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${btoa(`${apiKey}:${apiToken}`)}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: AbortSignal.timeout(20_000),
    },
  );
  const payload = (await response.json()) as {
    call?: { sid?: string; status?: string };
    error_data?: { message?: string };
  };
  if (!response.ok || !payload.call?.sid)
    throw new Error(
      payload.error_data?.message || `Call start failed (${response.status}).`,
    );
  const latencyMs = Date.now() - started;
  await recordUsage(
    input.organizationId,
    'provider_telephony',
    'telephony',
    'call_start',
    latencyMs,
    payload.call.sid,
  );
  return {
    providerReference: payload.call.sid,
    status: payload.call.status || 'queued',
    latencyMs,
  };
}

export async function testIntegrationConnection(
  organizationId: string,
  integrationId: string,
) {
  const row = await getRawDb()
    .prepare(`SELECT type, public_config_json, encrypted_secret
    FROM integration_connections WHERE id = ? AND organization_id = ? LIMIT 1`)
    .bind(integrationId, organizationId)
    .first<{ type: string } & StoredConnection>();
  if (!row || !row.encrypted_secret)
    throw new Error('Configured integration was not found.');
  const secrets = await decodeSecrets(row.encrypted_secret);
  const config = safeObject(row.public_config_json);
  const baseUrl = configString(config, 'baseUrl');
  if (row.type === 'razorpay') {
    const keyId = configString(config, 'accountId');
    if (!keyId || !secrets.apiKey)
      throw new Error('Razorpay key ID and secret are required.');
    return probe('https://api.razorpay.com/v1/payments?count=1', {
      authorization: `Basic ${btoa(`${keyId}:${secrets.apiKey}`)}`,
    });
  }
  if (row.type === 'anthropic_reasoning') {
    return probe('https://api.anthropic.com/v1/models', {
      'x-api-key': secrets.apiKey || '',
      'anthropic-version': '2023-06-01',
    });
  }
  if (row.type === 'openai_platform') {
    return probe('https://api.openai.com/v1/models', {
      authorization: `Bearer ${secrets.apiKey || ''}`,
    });
  }
  if (row.type === 'elevenlabs_voice') {
    return probe('https://api.elevenlabs.io/v1/voices', {
      'xi-api-key': secrets.apiKey || '',
    });
  }
  if (row.type === 'sarvam_voice') {
    if (!secrets.apiKey) throw new Error('Voice API key is required.');
    return {
      ok: true,
      detail:
        'Credential format accepted; first synthesis performs the billable health check.',
    };
  }
  if (!baseUrl || !secrets.apiKey)
    throw new Error(
      'Base URL and API key are required for this connection test.',
    );
  return probe(baseUrl, { authorization: `Bearer ${secrets.apiKey}` });
}

async function probe(url: string, headers: HeadersInit) {
  const response = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok)
    throw new Error(`Provider returned HTTP ${response.status}.`);
  return {
    ok: true,
    detail: `Provider responded with HTTP ${response.status}.`,
  };
}

async function synthesizeGlobalSpeech(input: {
  organizationId: string;
  text: string;
  languageCode: string;
  apiKey: string;
  voiceId: string;
  modelId?: string;
}) {
  const started = Date.now();
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.voiceId)}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': input.apiKey,
        accept: 'audio/mpeg',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: input.text.slice(0, 2500),
        model_id: input.modelId || 'eleven_multilingual_v2',
        output_format: 'mp3_44100_128',
        voice_settings: {
          stability: 0.48,
          similarity_boost: 0.72,
          style: 0.18,
          use_speaker_boost: true,
        },
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Voice synthesis failed (${response.status}): ${detail.slice(0, 180)}`,
    );
  }
  const latencyMs = Date.now() - started;
  const requestId = response.headers.get('request-id');
  const audioBase64 = bytesToBase64(
    new Uint8Array(await response.arrayBuffer()),
  );
  await recordUsage(
    input.organizationId,
    'provider_elevenlabs',
    'speech',
    'tts',
    latencyMs,
    requestId,
  );
  return {
    providerReference: requestId,
    audioBase64,
    latencyMs,
    contentType: response.headers.get('content-type') || 'audio/mpeg',
  };
}

async function reasonWithOpenAI(
  input: {
    organizationId: string;
    system: string;
    messages: Array<{
      role: 'user' | 'assistant';
      content: string | unknown[];
    }>;
    maxTokens?: number;
  },
  apiKey: string,
  storedModel: string,
) {
  const started = Date.now();
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || storedModel || 'gpt-5.4-mini',
      instructions: input.system,
      input: input.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      max_output_tokens: Math.max(40, Math.min(700, input.maxTokens ?? 700)),
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const payload = (await response.json()) as {
    id?: string;
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    error?: { message?: string };
  };
  if (!response.ok || !payload.id)
    throw new Error(
      payload.error?.message || `Reasoning failed (${response.status}).`,
    );
  const text =
    payload.output_text?.trim() ||
    (payload.output ?? [])
      .flatMap((item) => item.content ?? [])
      .map((item) =>
        item.type === 'output_text' ? item.text?.trim() || '' : '',
      )
      .filter(Boolean)
      .join(' ');
  if (!text) throw new Error('Vaani Realtime returned no spoken response.');
  const latencyMs = Date.now() - started;
  await recordUsage(
    input.organizationId,
    'provider_openai',
    'reasoning',
    'responses',
    latencyMs,
    payload.id,
  );
  return { id: payload.id, content: [{ type: 'text', text }], latencyMs };
}

function bytesToBase64(value: Uint8Array) {
  let binary = '';
  for (let index = 0; index < value.length; index += 0x8000) {
    binary += String.fromCharCode(
      ...value.subarray(index, Math.min(index + 0x8000, value.length)),
    );
  }
  return btoa(binary);
}

async function connectionCredentials(organizationId: string, type: string) {
  const row = await getRawDb()
    .prepare(`SELECT public_config_json, encrypted_secret FROM integration_connections
    WHERE organization_id = ? AND type = ? LIMIT 1`)
    .bind(organizationId, type)
    .first<StoredConnection>();
  return {
    publicConfig: safeObject(row?.public_config_json || '{}'),
    secrets: row?.encrypted_secret
      ? await decodeSecrets(row.encrypted_secret)
      : ({} as SecretBundle),
  };
}

// Platform-wide provider keys saved from the admin panel (encrypted). Read as a
// fallback after process.env and before per-organization integration secrets.
export async function platformProviderSecret(provider: string) {
  try {
    const row = await getRawDb()
      .prepare(
        `SELECT encrypted_secret, public_config_json FROM platform_provider_secrets WHERE provider = ? LIMIT 1`,
      )
      .bind(provider)
      .first<{ encrypted_secret: string | null; public_config_json: string }>();
    return {
      apiKey: row?.encrypted_secret
        ? await decryptSecret(row.encrypted_secret)
        : undefined,
      config: safeObject(row?.public_config_json || '{}'),
    };
  } catch {
    return { apiKey: undefined, config: {} as Record<string, unknown> };
  }
}

async function platformSecretMap() {
  try {
    const rows = await getRawDb()
      .prepare(
        `SELECT provider, encrypted_secret, public_config_json FROM platform_provider_secrets`,
      )
      .all<{
        provider: string;
        encrypted_secret: string | null;
        public_config_json: string;
      }>();
    const set = new Set<string>();
    const config = new Map<string, Record<string, unknown>>();
    for (const row of rows.results ?? []) {
      if (row.encrypted_secret) set.add(row.provider);
      config.set(row.provider, safeObject(row.public_config_json || '{}'));
    }
    return { set, config };
  } catch {
    return { set: new Set<string>(), config: new Map() };
  }
}

async function decodeSecrets(encrypted: string): Promise<SecretBundle> {
  const value = await decryptSecret(encrypted);
  try {
    return JSON.parse(value) as SecretBundle;
  } catch {
    return { apiKey: value };
  }
}

function safeObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function configString(config: Record<string, unknown>, key: string) {
  return typeof config[key] === 'string' ? config[key] : '';
}

function readiness(
  adapter: string,
  publicName: string,
  configured: boolean,
  required: string[],
): ProviderReadiness {
  const missing = configured
    ? []
    : required.filter((name) => !process.env[name]);
  return {
    adapter,
    publicName,
    configured,
    liveCapable: configured,
    missing,
    mode: configured ? 'live' : 'sandbox',
  };
}

function extractText(content: unknown[] | undefined) {
  return (content ?? [])
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const value = block as { type?: unknown; text?: unknown };
      return value.type === 'text' && typeof value.text === 'string'
        ? value.text.trim()
        : '';
    })
    .filter(Boolean)
    .join(' ')
    .trim();
}

function languageName(code: string) {
  const names: Record<string, string> = {
    'hi-IN': 'Hindi written in Devanagari',
    'pa-IN': 'Punjabi written in Gurmukhi',
    'bn-IN': 'Bengali',
    'ta-IN': 'Tamil',
    'te-IN': 'Telugu',
    'mr-IN': 'Marathi',
    'gu-IN': 'Gujarati',
    'kn-IN': 'Kannada',
    'ml-IN': 'Malayalam',
    'ur-IN': 'Urdu',
  };
  return names[code] || 'Hindi written in Devanagari';
}

export class ProviderConfigurationError extends Error {}

async function recordUsage(
  organizationId: string,
  providerId: string,
  category: string,
  operation: string,
  latencyMs: number,
  referenceId: string | null,
) {
  await getRawDb()
    .prepare(`INSERT INTO provider_usage_events
    (id, organization_id, provider_id, category, operation, units, provider_cost_micros,
     billed_credits, latency_ms, status, reference_id)
    VALUES (?, ?, ?, ?, ?, 1, 0, 0, ?, 'success', ?)`)
    .bind(
      `usage_${crypto.randomUUID()}`,
      organizationId,
      providerId,
      category,
      operation,
      latencyMs,
      referenceId,
    )
    .run();
}
