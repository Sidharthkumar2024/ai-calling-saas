export type LiveReasonedTurn = {
  text: string;
  latencyMs: number;
  providerReference?: string | null;
  toolCalls?: Array<{ name: string; input: unknown; result: unknown }>;
};

export type LiveSynthesizedSpeech = {
  audioBase64: string;
  contentType: string;
  latencyMs: number;
  providerReference?: string | null;
};

/**
 * Completes the part of a live carrier turn that must always result in audio.
 *
 * The customer playground already keeps talking when its reasoning provider is
 * unavailable by using a deterministic reply. Carrier calls need the same
 * behaviour: STT may have heard the caller perfectly, so dropping the whole
 * turn because the LLM is missing or briefly unavailable creates unexplained
 * silence. Only reasoning falls back here; synthesis still uses the selected
 * connected voice engine and therefore returns real carrier-playable audio.
 */
export async function resolveSpokenLiveTurn(input: {
  fallback: { text: string; latencyMs: number };
  reason: () => Promise<LiveReasonedTurn>;
  synthesize: (text: string) => Promise<LiveSynthesizedSpeech>;
  onReasoningFallback?: (error: unknown) => void;
}) {
  let mode: 'connected' | 'fallback' = 'connected';
  let reasoned: LiveReasonedTurn;

  try {
    reasoned = await input.reason();
  } catch (error) {
    mode = 'fallback';
    input.onReasoningFallback?.(error);
    reasoned = {
      text: input.fallback.text,
      latencyMs: input.fallback.latencyMs,
      providerReference: null,
      // Playground actions are previews. A live fallback must never claim it
      // executed one, so only the safe spoken reply crosses this boundary.
      toolCalls: [],
    };
  }

  const speech = await input.synthesize(reasoned.text);
  if (!speech.audioBase64)
    throw new Error('Voice synthesis returned no audio for the live turn.');

  return {
    mode,
    text: reasoned.text,
    reasoningLatencyMs: reasoned.latencyMs,
    toolCalls: reasoned.toolCalls ?? [],
    speech,
  };
}
