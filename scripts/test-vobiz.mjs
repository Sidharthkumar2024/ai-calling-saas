/**
 * The carrier this product resells.
 *
 * Vaani is a reseller partner rather than a direct customer, so a workspace
 * here is a sub-account there — its own credentials, balance, concurrency,
 * numbers and KYC. Everything below is the part of that contract which can be
 * checked without a network, and the checks are written against Vobiz's own
 * documented shapes rather than against a similar provider's: this API looks
 * like Plivo's and is not it.
 */
import assert from 'node:assert/strict';

import { createHmac } from 'node:crypto';

import {
  VOBIZ_MAX_DESTINATIONS,
  readVobizCallAccepted,
  readVobizCallback,
  readVobizError,
  verifyVobizSignature,
  vobizCallBody,
  vobizCallUrl,
  vobizDestinations,
  vobizHangupUrl,
  vobizHeaders,
  vobizStreamXml,
} from '../lib/vobiz.ts';
import { normaliseCallStatus } from '../lib/telephony-status.ts';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};

// --- where a request goes, and who it says it is ----------------------------------

equal(
  vobizCallUrl('MA_12345678'),
  'https://api.vobiz.ai/api/v1/Account/MA_12345678/Call/',
);
equal(
  vobizHangupUrl('MA_12345678', 'uuid-1'),
  'https://api.vobiz.ai/api/v1/Account/MA_12345678/Call/uuid-1',
);
// A sub-account's own credentials, because a call placed with the master's
// would be billed to us and recorded against the wrong account.
const headers = vobizHeaders({ authId: 'MA_12345678', authToken: 'secret' });
equal(headers['X-Auth-ID'], 'MA_12345678');
equal(headers['X-Auth-Token'], 'secret');
equal(headers['content-type'], 'application/json');

// --- the body their endpoint takes ------------------------------------------------

const body = vobizCallBody({
  from: '+91 124 498 2201',
  to: '+91 98123-45678',
  answerUrl:
    'https://vaani.example/api/webhooks/telephony/vobiz/answer?call=call_1',
  hangupUrl: 'https://vaani.example/api/webhooks/telephony/vobiz?call=call_1',
});
// E.164 without the plus, punctuation stripped, as their examples show.
equal(body.from, '911244982201');
equal(body.to, '919812345678');
equal(
  body.answer_url,
  'https://vaani.example/api/webhooks/telephony/vobiz/answer?call=call_1',
);
// Named rather than left to their default, so a change at their end does not
// silently change how our own endpoint is called.
equal(body.answer_method, 'POST');
equal(body.hangup_method, 'POST');
// An hour, not their four-hour default — this product pays for the minutes.
equal(body.time_limit, 3600);
ok(!('ring_url' in body), 'a callback nobody asked for is not sent as empty');
ok(!('caller_name' in body), 'nor is an absent caller name');
ok(!('machine_detection' in body), 'machine detection is off unless asked for');

const bounded = vobizCallBody({
  from: '1',
  to: '2',
  answerUrl: 'https://x/y',
  timeLimitSeconds: 999_999,
});
equal(bounded.time_limit, 86_400, 'their ceiling is honoured');
equal(
  vobizCallBody({
    from: '1',
    to: '2',
    answerUrl: 'https://x/y',
    timeLimitSeconds: 1,
  }).time_limit,
  30,
  'and a floor, so a call cannot be cut off before it rings',
);

const full = vobizCallBody({
  from: '911244982201',
  to: '919812345678',
  answerUrl: 'https://x/answer',
  ringUrl: 'https://x/ring',
  fallbackUrl: 'https://x/fallback',
  callerName:
    'A very long caller name that goes well past the fifty character ceiling they document',
  machineDetection: 'hangup',
});
equal(full.ring_method, 'POST');
equal(full.fallback_method, 'POST');
equal(String(full.caller_name).length, 50, 'their fifty-character ceiling');
equal(full.machine_detection, 'hangup');

// --- more than one destination ----------------------------------------------------

// THE MISTAKE WAITING TO BE MADE: Vobiz separates destinations with '<', not a
// comma. A comma-joined list is one malformed number, not five calls.
equal(
  vobizDestinations(['+919812345678', '+919812345679']),
  '919812345678<919812345679',
);
assert.throws(
  () =>
    vobizDestinations(
      Array.from({ length: VOBIZ_MAX_DESTINATIONS + 1 }, () => '919812345678'),
    ),
  /at most 1000/,
);
checks += 1;

// --- their answer to a call request -----------------------------------------------

const accepted = readVobizCallAccepted({
  api_id: 'api-1',
  message: 'Call fired',
  request_uuid: 'uuid-1',
});
equal(accepted.callUuid, 'uuid-1');
equal(accepted.apiId, 'api-1');
// "Call fired" means queued. Nothing here may read it as answered — that is
// the provider's own wording and the distinction this product keeps.
equal(accepted.message, 'Call fired');
// A body with no uuid is not a call: better a provider failure than a row
// nothing can ever settle.
equal(readVobizCallAccepted({ message: 'Call fired' }), null);
equal(readVobizCallAccepted(null), null);
equal(readVobizCallAccepted('nope'), null);

// --- their callbacks ---------------------------------------------------------------

const ring = readVobizCallback({
  Event: 'Ring',
  CallStatus: 'ringing',
  From: '911244982201',
  To: '919812345678',
  CallUUID: 'uuid-1',
  RequestUUID: 'uuid-1',
  SessionStart: '2026-09-12T06:00:00Z',
});
equal(ring.callUuid, 'uuid-1');
equal(ring.status, 'ringing');
// `Event` says which callback fired; `CallStatus` says what state the call is
// in. Only the second belongs in a call record.
equal(ring.event, 'Ring');

const hangup = readVobizCallback({
  Event: 'Hangup',
  CallStatus: 'completed',
  CallUUID: 'uuid-1',
  From: '911244982201',
  To: '919812345678',
  StartTime: '2026-09-12T06:00:00Z',
  AnswerTime: '2026-09-12T06:00:09Z',
  EndTime: '2026-09-12T06:02:11Z',
  // Their hangup callback lower-cases this one where the others do not, which
  // is why nothing here assumes a single convention.
  stir_verification: 'Validation',
});
equal(hangup.status, 'completed');
equal(hangup.answeredAt, '2026-09-12T06:00:09Z');
equal(hangup.endedAt, '2026-09-12T06:02:11Z');
// Talk time, not ring time: 06:00:09 to 06:02:11 is 122 seconds, and the nine
// seconds the phone spent ringing belong to nobody's bill.
equal(hangup.talkSeconds, 122);
// A call that rang out has an end and no answer, so it has no talk time — not
// zero-by-accident, and certainly not the ring duration.
equal(
  readVobizCallback({
    Event: 'Hangup',
    CallStatus: 'no-answer',
    CallUUID: 'uuid-2',
    StartTime: '2026-09-12T06:00:00Z',
    EndTime: '2026-09-12T06:00:30Z',
  }).talkSeconds,
  null,
);

// A callback with no call in it is not a callback.
equal(readVobizCallback({ Event: 'Hangup' }), null);

// --- their words, in this product's vocabulary -------------------------------------

// Every status they send already lands on a status this product knows, so the
// webhook needs no table of its own.
equal(normaliseCallStatus('ringing'), 'ringing');
equal(normaliseCallStatus('in-progress'), 'in_progress');
equal(normaliseCallStatus('completed'), 'completed');

// --- the XML they fetch when the call is answered ---------------------------------

const xml = vobizStreamXml({
  streamUrl: 'wss://calls.vaani.example/media?agent=a_1&t=abc',
  statusCallbackUrl:
    'https://vaani.example/api/webhooks/telephony/vobiz/stream',
});
// THE MISTAKE WAITING TO BE MADE, part two: on the carriers this API resembles
// the socket URL is an attribute. Here it is the element's text, and an
// attribute named `url` would be ignored silently — a call that connects,
// bills, and streams to nobody.
ok(!xml.includes('url="wss://'), 'the stream URL is not an attribute');
ok(
  xml.includes('>wss://calls.vaani.example/media?agent=a_1&amp;t=abc</Stream>'),
  'the stream URL is the element text, with & escaped',
);
ok(xml.includes('bidirectional="true"'), 'the agent has to be able to speak');
ok(xml.includes('keepCallAlive="true"'), 'the conversation is the whole call');
// Their default timeout is 86400 — a day of billed audio on a call that nobody
// hung up. An hour is still generous and is bounded.
ok(xml.includes('streamTimeout="3600"'), 'an hour, not a day');
ok(xml.includes('contentType="audio/x-l16;rate=16000"'), 'wideband by default');
ok(
  xml.includes('statusCallbackMethod="POST"'),
  'a status callback URL brings its method with it',
);
// No callback URL, no callback attributes: an empty statusCallbackUrl would be
// a URL they would try to POST to.
ok(
  !vobizStreamXml({ streamUrl: 'wss://calls.vaani.example/media' }).includes(
    'statusCallback',
  ),
  'no status callback attributes when there is no URL',
);
equal(
  vobizStreamXml({
    streamUrl: 'wss://calls.vaani.example/media',
    streamTimeoutSeconds: 999_999,
  }).includes('streamTimeout="86400"'),
  true,
  'their own ceiling is still the ceiling',
);
assert.throws(
  () => vobizStreamXml({ streamUrl: 'ws://calls.vaani.example/media' }),
  /wss/,
  'plain ws:// carries the call audio in the clear',
);
checks += 1;

// --- proving a callback came from them --------------------------------------------

const TOKEN = 'token-for-this-sub-account';
const sign = (message) =>
  createHmac('sha256', TOKEN).update(message).digest('base64');
const headersFrom = (entries) => ({
  get: (name) => {
    const found = Object.entries(entries).find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    );
    return found ? found[1] : null;
  },
});

// The base URL is the callback URL with every query parameter stripped, so the
// signature for this request is the same whatever they append to it.
const CALLBACK_URL = 'https://vaani.example/api/webhooks/telephony/vobiz';
const v3 = await verifyVobizSignature({
  url: `${CALLBACK_URL}?CallUUID=uuid-1&CallStatus=completed`,
  authToken: TOKEN,
  headers: headersFrom({
    'X-Vobiz-Signature-V3': sign(`${CALLBACK_URL}.nonce-1`),
    'X-Vobiz-Signature-V3-Nonce': 'nonce-1',
  }),
});
equal(v3, { ok: true, version: 'v3' });

// V2 concatenates the URL and the nonce with nothing between them. Both
// versions are documented as current, so both are accepted.
const v2 = await verifyVobizSignature({
  url: CALLBACK_URL,
  authToken: TOKEN,
  headers: headersFrom({
    'X-Vobiz-Signature-V2': sign(`${CALLBACK_URL}nonce-2`),
    'X-Vobiz-Signature-V2-Nonce': 'nonce-2',
  }),
});
equal(v2, { ok: true, version: 'v2' });

// A V3 signature computed the V2 way — the dot is load-bearing.
equal(
  await verifyVobizSignature({
    url: CALLBACK_URL,
    authToken: TOKEN,
    headers: headersFrom({
      'X-Vobiz-Signature-V3': sign(`${CALLBACK_URL}nonce-3`),
      'X-Vobiz-Signature-V3-Nonce': 'nonce-3',
    }),
  }),
  { ok: false, version: null },
);

// Another workspace's token, on a request addressed to this URL.
equal(
  await verifyVobizSignature({
    url: CALLBACK_URL,
    authToken: 'someone-elses-token',
    headers: headersFrom({
      'X-Vobiz-Signature-V3': sign(`${CALLBACK_URL}.nonce-4`),
      'X-Vobiz-Signature-V3-Nonce': 'nonce-4',
    }),
  }),
  { ok: false, version: null },
);

// A signature with no nonce cannot be checked, and unchecked is not valid.
equal(
  await verifyVobizSignature({
    url: CALLBACK_URL,
    authToken: TOKEN,
    headers: headersFrom({
      'X-Vobiz-Signature-V3': sign(`${CALLBACK_URL}.nonce-5`),
    }),
  }),
  { ok: false, version: null },
);

// No headers at all. Worth stating on its own: this is what an unsigned POST
// from anyone on the internet looks like.
equal(
  await verifyVobizSignature({
    url: CALLBACK_URL,
    authToken: TOKEN,
    headers: headersFrom({}),
  }),
  { ok: false, version: null },
);

// A workspace with no token configured cannot verify anything, and must not
// therefore accept everything.
equal(
  await verifyVobizSignature({
    url: CALLBACK_URL,
    authToken: '',
    headers: headersFrom({
      'X-Vobiz-Signature-V3': sign(`${CALLBACK_URL}.nonce-6`),
      'X-Vobiz-Signature-V3-Nonce': 'nonce-6',
    }),
  }),
  { ok: false, version: null },
);

// What a valid signature does NOT say. It covers the URL and a nonce, never
// the body — so a payload that verifies is still only a claim, and the call it
// names still has to be looked up and scoped to a workspace.
const signedForThisUrl = headersFrom({
  'X-Vobiz-Signature-V3': sign(`${CALLBACK_URL}.nonce-7`),
  'X-Vobiz-Signature-V3-Nonce': 'nonce-7',
});
equal(
  await verifyVobizSignature({
    url: CALLBACK_URL,
    authToken: TOKEN,
    headers: signedForThisUrl,
  }),
  { ok: true, version: 'v3' },
);
// Same signature, different callback URL: rejected. The signature is bound to
// where it was sent.
equal(
  await verifyVobizSignature({
    url: 'https://vaani.example/api/webhooks/telephony/vobiz/stream',
    authToken: TOKEN,
    headers: signedForThisUrl,
  }),
  { ok: false, version: null },
);

// --- what they say when something is wrong ----------------------------------------

// The two a customer has to be able to tell apart.
const broke = readVobizError(402, {
  status: 'error',
  error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' },
});
equal(broke.code, 'INSUFFICIENT_BALANCE');
equal(broke.retryable, false, 'retrying an empty wallet just empties it again');
ok(/balance/i.test(broke.message), 'the customer is told what to do about it');

const limited = readVobizError(429, {
  status: 'error',
  error: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Rate limit exceeded',
    details: { limitType: 'calls_per_minute', retryAfter: 30 },
  },
});
equal(limited.retryable, true, 'a rate limit passes');

equal(
  readVobizError(401, {
    status: 'error',
    error: { code: 'INVALID_CREDENTIALS' },
  }).retryable,
  false,
);
// A 500 with no envelope at all — their gateway, not their API.
const gateway = readVobizError(502, '<html>Bad Gateway</html>');
equal(gateway.code, 'HTTP_502');
equal(gateway.retryable, true);

console.log(`vobiz: ${checks} assertions passed; no provider contacted.`);
