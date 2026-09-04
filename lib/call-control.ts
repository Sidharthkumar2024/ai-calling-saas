/**
 * Reaching a live call (§4).
 *
 * Mute, hold, supervisor monitoring and hanging up were all listed as "the
 * gateway can carry them, but they need a control channel from the Agent Desk
 * to a live session". This is that channel.
 *
 * It only goes one way. The Vaani worker cannot hold a socket open — no
 * WebSocket binding, no Durable Objects — so it cannot be *told* about a call;
 * it tells the gateway, over plain HTTP, and reads the resulting state from the
 * response. That is enough for every control here, all of which are commands.
 *
 * The gateway's base URL is derived from `VOICE_STREAM_URL`, the same value the
 * carrier is pointed at, so there is no second URL to configure and get wrong.
 */

export const CALL_CONTROL_ACTIONS = [
  'mute',
  'unmute',
  'hold',
  'resume',
  'set_mode',
  'hangup',
] as const;

export type CallControlAction = (typeof CALL_CONTROL_ACTIONS)[number];

export function isCallControlAction(
  value: unknown,
): value is CallControlAction {
  return (
    typeof value === 'string' &&
    (CALL_CONTROL_ACTIONS as readonly string[]).includes(value)
  );
}

/**
 * Turns the carrier stream URL into the gateway's HTTP origin.
 *
 * `wss://gateway.example.com/stream?carrier=exotel` becomes
 * `https://gateway.example.com`. Returns null rather than guessing when the
 * value is missing or unusable — a control command sent to a wrong host is
 * worse than one that was never sent, because the operator is told it worked.
 */
export function controlEndpoint(streamUrl: string | undefined): string | null {
  const raw = (streamUrl ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === 'wss:') url.protocol = 'https:';
    else if (url.protocol === 'ws:') url.protocol = 'http:';
    else if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.origin}/control`;
  } catch {
    return null;
  }
}

export type ControlResult =
  | {
      ok: true;
      results: Array<Record<string, unknown>>;
    }
  | { ok: false; status: number; error: string };

/**
 * Sends one command to whichever gateway legs are on this call.
 *
 * `legId` is optional and load-bearing: muting one participant is not muting
 * the call, so omitting it addresses every leg and naming it addresses one.
 */
export async function sendCallControl(input: {
  callId: string;
  action: CallControlAction;
  legId?: string | null;
  mode?: string | null;
  whisperTo?: string | null;
}): Promise<ControlResult> {
  const endpoint = controlEndpoint(process.env.VOICE_STREAM_URL);
  const secret = process.env.MEDIA_GATEWAY_SECRET ?? '';
  if (!endpoint)
    return {
      ok: false,
      status: 503,
      error:
        'No media gateway is configured, so there is no live call to control. Set VOICE_STREAM_URL.',
    };
  if (!secret)
    return {
      ok: false,
      status: 503,
      error:
        'MEDIA_GATEWAY_SECRET is not set, so the gateway would reject this command.',
    };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vaani-gateway-secret': secret,
      },
      body: JSON.stringify({
        callId: input.callId,
        action: input.action,
        ...(input.legId ? { legId: input.legId } : {}),
        ...(input.mode ? { mode: input.mode } : {}),
        ...(input.whisperTo ? { whisperTo: input.whisperTo } : {}),
      }),
      // Short: this is a live call. An operator pressing hold needs an answer
      // now, and a command that lands ten seconds late is not the one they
      // meant to give.
      signal: AbortSignal.timeout(4000),
    });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: `The media gateway did not answer: ${
        error instanceof Error ? error.message : 'unreachable'
      }`,
    };
  }

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    results?: Array<Record<string, unknown>>;
  };
  if (!response.ok)
    return {
      ok: false,
      status: response.status,
      error:
        payload.error ??
        `The gateway refused the command (${response.status}).`,
    };
  return { ok: true, results: payload.results ?? [] };
}
