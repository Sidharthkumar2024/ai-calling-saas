/**
 * Vobiz — the carrier this product resells (§ carrier integration).
 *
 * Vaani is a reseller partner rather than a direct carrier customer, so a
 * workspace here becomes a *sub-account* there: it holds its own credentials,
 * its own balance, its own concurrency allocation, its own numbers and its own
 * KYC. That matters for every call this module builds — a call placed with the
 * master credentials would be billed to us and recorded against the wrong
 * account.
 *
 * What is pure lives here and is tested directly. Anything that touches a
 * network lives in `lib/provider-adapters.ts` beside the other carriers.
 *
 * Two facts from their documentation that shape everything below:
 *
 *  - A 200 from the call endpoint means the call was **accepted and queued**,
 *    not that anybody answered. Reporting it as connected would be the same
 *    lie this product keeps finding elsewhere.
 *  - Callbacks are signed with HMAC-SHA256 and retried up to three times on a
 *    non-200. So the receiver has to verify, and has to be idempotent.
 */

/** Their API, and the one path shape everything hangs off. */
export const VOBIZ_BASE_URL = 'https://api.vobiz.ai';

/** An auth id looks like `MA_XXXXXXXX`; the token is a password. */
export type VobizCredentials = { authId: string; authToken: string };

export function vobizHeaders(credentials: VobizCredentials) {
  return {
    'X-Auth-ID': credentials.authId,
    'X-Auth-Token': credentials.authToken,
    'content-type': 'application/json',
  };
}

export function vobizCallUrl(authId: string, baseUrl = VOBIZ_BASE_URL) {
  return `${baseUrl.replace(/\/$/, '')}/api/v1/Account/${encodeURIComponent(authId)}/Call/`;
}

export function vobizHangupUrl(
  authId: string,
  callUuid: string,
  baseUrl = VOBIZ_BASE_URL,
) {
  return `${baseUrl.replace(/\/$/, '')}/api/v1/Account/${encodeURIComponent(authId)}/Call/${encodeURIComponent(callUuid)}`;
}

export type VobizCallRequest = {
  /** The number this workspace owns, in E.164 without a plus. */
  from: string;
  to: string;
  /** Where Vobiz fetches the XML that drives the call. */
  answerUrl: string;
  /** Where Vobiz reports ringing, and where it reports the end. */
  ringUrl?: string | null;
  hangupUrl?: string | null;
  fallbackUrl?: string | null;
  callerName?: string | null;
  /** Seconds. Their ceiling is 86400; ours is an hour unless asked otherwise. */
  timeLimitSeconds?: number | null;
  /** 'true' answers a machine and carries on; 'hangup' ends the call. */
  machineDetection?: 'true' | 'hangup' | null;
};

/**
 * The body their call endpoint takes, as JSON.
 *
 * Only keys with a value are sent. An empty `hangup_url` is not the same as no
 * `hangup_url`, and a carrier given an empty string has been known to call it.
 */
export function vobizCallBody(
  input: VobizCallRequest,
): Record<string, string | number> {
  const digitsOnly = (value: string) => value.replace(/[^\d]/g, '');
  const body: Record<string, string | number> = {
    from: digitsOnly(input.from),
    to: digitsOnly(input.to),
    answer_url: input.answerUrl,
    // Named rather than left to their default, so a change at their end does
    // not silently change how our own endpoint is called.
    answer_method: 'POST',
  };
  if (input.ringUrl) {
    body.ring_url = input.ringUrl;
    body.ring_method = 'POST';
  }
  if (input.hangupUrl) {
    body.hangup_url = input.hangupUrl;
    body.hangup_method = 'POST';
  }
  if (input.fallbackUrl) {
    body.fallback_url = input.fallbackUrl;
    body.fallback_method = 'POST';
  }
  if (input.callerName) body.caller_name = input.callerName.slice(0, 50);
  if (input.machineDetection) body.machine_detection = input.machineDetection;
  // Their ceiling is 86400 and their default 14400 — four hours on a call this
  // product never wants to be paying for. An hour unless told otherwise, and
  // never below their floor of a sensible ring.
  body.time_limit = Math.min(
    86_400,
    Math.max(30, Math.round(input.timeLimitSeconds || 3600)),
  );
  return body;
}

/**
 * Their multi-destination form.
 *
 * Vobiz takes up to a thousand destinations separated by `<` — not by commas,
 * which is the mistake waiting to be made. This product dials one at a time
 * and keeps this here so nobody reaches for `join(',')` later.
 */
export const VOBIZ_DESTINATION_SEPARATOR = '<';
export const VOBIZ_MAX_DESTINATIONS = 1000;

export function vobizDestinations(numbers: string[]): string {
  if (numbers.length > VOBIZ_MAX_DESTINATIONS)
    throw new Error(
      `Vobiz takes at most ${VOBIZ_MAX_DESTINATIONS} destinations in one call.`,
    );
  return numbers
    .map((number) => number.replace(/[^\d]/g, ''))
    .filter(Boolean)
    .join(VOBIZ_DESTINATION_SEPARATOR);
}

export type VobizCallAccepted = {
  /** Their id for the call. `request_uuid` and `call_uuid` are the same thing. */
  callUuid: string;
  apiId: string | null;
  message: string | null;
};

/**
 * Reads their answer to a call request.
 *
 * Returns null when the body is not one, so the caller reports a provider
 * failure rather than recording a call with no id — which would be a row
 * nothing could ever settle.
 */
export function readVobizCallAccepted(body: unknown): VobizCallAccepted | null {
  if (!body || typeof body !== 'object') return null;
  const row = body as Record<string, unknown>;
  const uuid = typeof row.request_uuid === 'string' ? row.request_uuid : '';
  if (!uuid) return null;
  return {
    callUuid: uuid,
    apiId: typeof row.api_id === 'string' ? row.api_id : null,
    message: typeof row.message === 'string' ? row.message : null,
  };
}

/**
 * What one of their callbacks is about.
 *
 * Their field names are capitalised (`CallUUID`, `CallStatus`) and the hangup
 * callback lower-cases one of them (`stir_verification`), so nothing here
 * assumes a single convention. The call-specific guide uses `CallStatus`, the
 * generic callback guide uses `Status`, and lifecycle events provide a safe
 * fallback when either status field is omitted. Stream events intentionally
 * remain statusless so they cannot overwrite the call lifecycle.
 */
export type VobizCallback = {
  event: string;
  callUuid: string;
  status: string;
  from: string;
  to: string;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  /**
   * Talk time in seconds, or null when the call was never answered.
   *
   * Derived from their two timestamps rather than read from a duration field,
   * because a ring that nobody picked up has an end time and no answer time —
   * and billing a customer for the seconds their phone rang is the sort of
   * charge that is only ever found by the person who was charged.
   */
  talkSeconds: number | null;
  /** Total carrier-reported call duration, used for history but not billing. */
  durationSeconds: number | null;
  /** Carrier-provided reason, when a completed call includes one. */
  disconnectReason: string | null;
};

export function readVobizCallback(
  payload: Record<string, unknown>,
): VobizCallback | null {
  const text = (value: unknown) =>
    typeof value === 'string' ? value.trim() : '';
  const first = (...keys: string[]) => {
    for (const key of keys) {
      const found = text(payload[key]);
      if (found) return found;
    }
    return '';
  };
  const firstSeconds = (...keys: string[]) => {
    for (const key of keys) {
      const value = payload[key];
      if (value === null || value === undefined || value === '') continue;
      const seconds = Number(value);
      if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds));
    }
    return null;
  };
  const callUuid = first(
    'CallUUID',
    'call_uuid',
    'RequestUUID',
    'request_uuid',
  );
  if (!callUuid) return null;
  const event = first('Event', 'event');
  const answeredAt = first('AnswerTime') || null;
  // The call API's hangup callback documents `EndTime`; the generic callback
  // contract also guarantees `timestamp`. An authoritative Hangup must still
  // carry a usable end time when only that generic field is delivered, rather
  // than leaving the record live forever.
  const endedAt =
    first('EndTime', 'end_time') ||
    (/^hangup$/i.test(event) ? first('Timestamp', 'timestamp') : '') ||
    null;
  // Vobiz currently documents `CallStatus` on the call-specific callback and
  // `Status` on the generic webhook example. Accept both. Stream callbacks do
  // not include either field; they deliberately stay blank so the call-status
  // route can recognise them as transport telemetry rather than walking a
  // live call back to `processing`.
  const reportedStatus = first(
    'CallStatus',
    'call_status',
    'Status',
    'status',
  );
  const status =
    reportedStatus ||
    (/^hangup$/i.test(event)
      ? 'completed'
      : /^ring$/i.test(event)
        ? 'ringing'
        : /^startapp$/i.test(event)
          ? 'in-progress'
          : '');
  const timestampTalkSeconds = secondsBetween(answeredAt, endedAt);
  // Prefer bill/talk duration when Vobiz supplies it. The generic `Duration`
  // includes ringing on some accounts, so it is safe for call history but not
  // for wallet charging when no billable duration or answer timestamp exists.
  const talkSeconds =
    timestampTalkSeconds ??
    firstSeconds(
      'BillDuration',
      'bill_duration',
      'BillSeconds',
      'bill_seconds',
      'BillSec',
      'billsec',
      'ConversationDuration',
      'conversation_duration',
    );
  const durationSeconds =
    firstSeconds('Duration', 'duration') ?? talkSeconds;
  return {
    event,
    callUuid,
    status,
    from: first('From', 'from'),
    to: first('To', 'to'),
    startedAt: first('StartTime', 'SessionStart') || null,
    answeredAt,
    endedAt,
    talkSeconds,
    durationSeconds,
    disconnectReason:
      first(
        'HangupCauseName',
        'hangup_cause_name',
        'HangupCause',
        'hangup_cause',
        'FailureReason',
        'failure_reason',
      ) || null,
  };
}

/** Whole seconds between two of their timestamps, or null if either is unusable. */
function secondsBetween(from: string | null, to: string | null) {
  if (!from || !to) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  // Clocks and retries both produce an end before a start. Zero, not negative.
  return Math.max(0, Math.round((end - start) / 1000));
}

/* ------------------------------------------------------------------------- *
 * The XML Vobiz fetches when the call is answered.
 * ------------------------------------------------------------------------- */

/**
 * The audio formats their `<Stream>` accepts *inbound* — carrier to us.
 *
 * Written as one string carrying both the type and the rate, which is their
 * shape and not ours. Outbound audio, us to them, is configured per message
 * instead with the type and the rate as two separate fields, and supports a
 * rate this list does not: their documentation says in as many words not to
 * configure 24 kHz as the inbound format.
 */
export const VOBIZ_INBOUND_FORMATS = [
  'audio/x-l16;rate=8000',
  'audio/x-l16;rate=16000',
  'audio/x-mulaw;rate=8000',
] as const;

export type VobizInboundFormat = (typeof VOBIZ_INBOUND_FORMATS)[number];

/** XML text, with the five characters that would otherwise end an element. */
function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export type VobizStreamOptions = {
  /** Our gateway. Their platform is the WebSocket client and dials this. */
  streamUrl: string;
  /** False sends us the caller only; true lets us speak back. */
  bidirectional?: boolean;
  /** 'inbound' is the caller, 'outbound' the far end, 'both' is a mix. */
  audioTrack?: 'inbound' | 'outbound' | 'both';
  contentType?: VobizInboundFormat;
  statusCallbackUrl?: string | null;
  /** Seconds. Their default is a day, which is not a phone call. */
  streamTimeoutSeconds?: number | null;
  /**
   * True runs the stream exclusively: later XML only executes once the socket
   * disconnects. For an agent that holds the whole conversation, that is what
   * is wanted — anything after it is a fallback, not a follow-on.
   */
  keepCallAlive?: boolean;
};

/**
 * The document their answer_url must return.
 *
 * The socket URL is the element's *text*, not an attribute — their shape, and
 * the thing most likely to be got wrong by someone who has written this for
 * another carrier.
 */
export function vobizStreamXml(options: VobizStreamOptions): string {
  if (!options.streamUrl.startsWith('wss://'))
    throw new Error('A secure wss:// media stream URL is required.');
  const attributes: Array<[string, string]> = [
    ['bidirectional', options.bidirectional === false ? 'false' : 'true'],
    ['audioTrack', options.audioTrack ?? 'inbound'],
    ['contentType', options.contentType ?? 'audio/x-l16;rate=16000'],
    ['keepCallAlive', options.keepCallAlive === false ? 'false' : 'true'],
  ];
  if (options.statusCallbackUrl) {
    attributes.push(['statusCallbackUrl', options.statusCallbackUrl]);
    attributes.push(['statusCallbackMethod', 'POST']);
  }
  // Their default is 86400 — a day of billed audio for a call nobody hung up.
  attributes.push([
    'streamTimeout',
    String(
      Math.min(
        86_400,
        Math.max(30, Math.round(options.streamTimeoutSeconds || 3600)),
      ),
    ),
  ]);
  const rendered = attributes
    .map(([name, value]) => `${name}="${escapeXml(value)}"`)
    .join(' ');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `  <Stream ${rendered}>${escapeXml(options.streamUrl)}</Stream>`,
    '</Response>',
  ].join('\n');
}

/* ------------------------------------------------------------------------- *
 * Verifying that a callback came from Vobiz.
 * ------------------------------------------------------------------------- */

async function hmacSha256Base64(message: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

/** Length-independent compare, so a wrong signature leaks nothing by timing. */
function sameSignature(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

/**
 * Whether a callback carries Vobiz's signature.
 *
 * **What the signature does and does not attest to.** Their documentation is
 * explicit: "The signature covers the URL and a nonce, never the request
 * body." So a valid signature proves the request was addressed to this URL by
 * somebody holding the auth token — and proves nothing whatsoever about the
 * payload. Anything read out of the body still has to be treated as a claim:
 * look the call up by its uuid and scope it to the workspace, exactly as if
 * the body were unsigned.
 *
 * V3 joins the base URL and the nonce with a dot; V2 concatenates them. Both
 * are accepted because both are documented as current, and the base URL is the
 * callback URL with every query parameter stripped.
 */
export async function verifyVobizSignature(input: {
  url: string;
  alternateUrls?: readonly string[];
  headers: { get(name: string): string | null };
  authToken: string;
}): Promise<{ ok: boolean; version: 'v3' | 'v2' | null }> {
  const bases = [input.url, ...(input.alternateUrls ?? [])]
    .map((url) => {
      try {
        const parsed = new URL(url);
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
      } catch {
        return '';
      }
    })
    .filter((url, index, all) => Boolean(url) && all.indexOf(url) === index);
  if (bases.length === 0 || !input.authToken)
    return { ok: false, version: null };

  const attempts: Array<{
    version: 'v3' | 'v2';
    signature: string | null;
    nonce: string | null;
    message: (base: string, nonce: string) => string;
  }> = [
    {
      version: 'v3',
      signature: input.headers.get('X-Vobiz-Signature-V3'),
      nonce: input.headers.get('X-Vobiz-Signature-V3-Nonce'),
      message: (base, nonce) => `${base}.${nonce}`,
    },
    {
      version: 'v2',
      signature: input.headers.get('X-Vobiz-Signature-V2'),
      nonce: input.headers.get('X-Vobiz-Signature-V2-Nonce'),
      message: (base, nonce) => `${base}${nonce}`,
    },
  ];

  for (const base of bases) {
    for (const attempt of attempts) {
      if (!attempt.signature || !attempt.nonce) continue;
      const expected = await hmacSha256Base64(
        attempt.message(base, attempt.nonce),
        input.authToken,
      );
      if (sameSignature(expected, attempt.signature))
        return { ok: true, version: attempt.version };
    }
  }
  return { ok: false, version: null };
}

/**
 * Rebuild the externally visible callback URL from a trusted deployment
 * setting. Reverse proxies commonly expose an internal request origin to the
 * application, while Vobiz signs the public HTTPS URL it was given. We never
 * use Host/X-Forwarded-* here: only the operator-controlled PUBLIC_BASE_URL is
 * allowed to add a signature candidate.
 */
export function vobizPublicCallbackUrl(
  requestUrl: string,
  publicBaseUrl: string | undefined,
) {
  if (!publicBaseUrl) return null;
  try {
    const incoming = new URL(requestUrl);
    const publicUrl = new URL(incoming.pathname, `${publicBaseUrl.replace(/\/$/, '')}/`);
    return publicUrl.toString();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------- *
 * What they say when something is wrong.
 * ------------------------------------------------------------------------- */

/**
 * Their error envelope, in this product's words.
 *
 * Two of their codes are ones a customer must be told apart: an empty balance
 * is the workspace's own to fix, and a rate limit is ours to wait out. Telling
 * a customer "the call could not be started" for either would be the shape of
 * error this product keeps removing.
 */
export function readVobizError(
  status: number,
  body: unknown,
): { code: string; message: string; retryable: boolean } {
  const envelope =
    body && typeof body === 'object'
      ? ((body as Record<string, unknown>).error as
          | Record<string, unknown>
          | undefined)
      : undefined;
  const code =
    envelope && typeof envelope.code === 'string' ? envelope.code : '';
  const provider =
    envelope && typeof envelope.message === 'string' ? envelope.message : '';
  // A 5xx or a rate limit is worth trying again; a rejected request is not.
  const retryable = status >= 500 || status === 429;
  if (code === 'INSUFFICIENT_BALANCE')
    return {
      code,
      message:
        'The telephony account has no balance left, so the call was not placed. Top it up and try again.',
      retryable: false,
    };
  if (code === 'RATE_LIMIT_EXCEEDED')
    return {
      code,
      message:
        'The carrier is taking calls faster than this account is allowed to place them. It will be tried again shortly.',
      retryable: true,
    };
  if (status === 401 || code === 'INVALID_CREDENTIALS')
    return {
      code: code || 'INVALID_CREDENTIALS',
      message:
        'The telephony credentials for this workspace were refused. Check them in Integrations.',
      retryable: false,
    };
  return {
    code: code || `HTTP_${status}`,
    message: provider || `The carrier refused the call (${status}).`,
    retryable,
  };
}
