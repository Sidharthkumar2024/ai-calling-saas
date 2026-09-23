/**
 * The two doors Vobiz knocks on.
 *
 * Their answer URL is fetched when a call is answered and its reply decides
 * where the audio goes; their status URL is how a call ends up billed. Both are
 * open to the internet and neither has a session, so what stands between them
 * and a stranger is one HMAC — which makes these the two routes in this product
 * most worth proving rather than reasoning about.
 *
 * Everything below runs against an in-memory SQLite database. No provider is
 * contacted, no call is placed, and the auth token is a string invented here.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

import * as telephonyStatus from '../lib/telephony-status.ts';
import * as vobiz from '../lib/vobiz.ts';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`CREATE TABLE call_records(
  id TEXT PRIMARY KEY, organization_id TEXT, status TEXT, duration_seconds INTEGER DEFAULT 0,
  cost_credits INTEGER DEFAULT 0, analysis_json TEXT DEFAULT '{}', ended_at TEXT,
  provider_reference TEXT, campaign_contact_id TEXT, disconnect_reason TEXT);
CREATE TABLE provider_usage_events(
  id TEXT PRIMARY KEY, organization_id TEXT, provider_id TEXT, category TEXT, operation TEXT,
  units INTEGER, provider_cost_micros INTEGER, billed_credits INTEGER, status TEXT, reference_id TEXT);
INSERT INTO call_records(id, organization_id, status) VALUES ('call_1', 'org_1', 'queued');
INSERT INTO call_records(id, organization_id, status) VALUES ('call_2', 'org_2', 'queued');
INSERT INTO call_records(id, organization_id, status) VALUES ('call_3', 'org_1', 'in_progress');
INSERT INTO call_records(id, organization_id, status) VALUES ('call_4', 'org_1', 'in_progress');`);

const db = {
  prepare(sql) {
    return {
      bind(...args) {
        return {
          async first() {
            return sqlite.prepare(sql).get(...args) ?? null;
          },
          async run() {
            return {
              meta: { changes: sqlite.prepare(sql).run(...args).changes },
            };
          },
          async all() {
            return { results: sqlite.prepare(sql).all(...args) };
          },
        };
      },
    };
  },
};

// The token is a test value, invented here and stored nowhere. `org_2` has no
// Vobiz connection at all, which is the case a workspace is in before anyone
// has filled the form in.
const TOKEN = 'token-for-org-1-only';
const credentials = {
  org_1: { authId: 'MA_00000001', authToken: TOKEN, baseUrl: undefined },
  org_2: { authId: '', authToken: '', baseUrl: undefined },
};

const settlements = [];
const campaignSettlements = [];
const modules = {
  '@/lib/campaign-settlement': {
    settleCampaignContactForCall: async (_db, event) =>
      campaignSettlements.push(event),
  },
  'next/server': {
    NextResponse: {
      json: (body, init) => new Response(JSON.stringify(body), init),
    },
  },
  '@/db/bootstrap': { ensureSchema: async () => {} },
  '@/db/index': { getRawDb: () => db },
  '@/lib/telephony-status': telephonyStatus,
  '@/lib/vobiz': vobiz,
  '@/lib/provider-adapters': {
    vobizWorkspaceCredentials: async (organizationId) =>
      credentials[organizationId] ?? { authId: '', authToken: '' },
  },
  '@/lib/exotel-settlement': {
    // The real rate, because the point of the assertion below is the number.
    exotelCredits: (seconds) => Math.max(1, Math.ceil(seconds / 60)),
    settleExotel: async (_db, organizationId, callId, credits) => {
      settlements.push({ organizationId, callId, credits });
      sqlite
        .prepare('UPDATE call_records SET cost_credits = ? WHERE id = ?')
        .run(credits, callId);
      return true;
    },
  },
};

const load = (path) => {
  const exports = {};
  compileFunction(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    ['require', 'exports', 'process'],
  )(
    (id) => {
      if (!modules[id]) throw Error(id);
      return modules[id];
    },
    exports,
    process,
  );
  return exports;
};

process.env.VOICE_STREAM_URL = 'wss://gateway.test/stream';
process.env.MEDIA_GATEWAY_SECRET = 'gateway-secret-for-test';
process.env.PUBLIC_BASE_URL = 'https://vaani.test';

const answer = load(
  '../app/api/webhooks/telephony/vobiz/answer/[callId]/route.ts',
);
const statusRoute = load(
  '../app/api/webhooks/telephony/vobiz/status/[callId]/route.ts',
);

const ANSWER_URL =
  'https://vaani.test/api/webhooks/telephony/vobiz/answer/call_1';
const STATUS_URL =
  'https://vaani.test/api/webhooks/telephony/vobiz/status/call_1';

const signed = (url, nonce, token = TOKEN) => ({
  'X-Vobiz-Signature-V3': createHmac('sha256', token)
    .update(`${url}.${nonce}`)
    .digest('base64'),
  'X-Vobiz-Signature-V3-Nonce': nonce,
});

const post = (route, url, callId, { headers = {}, form, json } = {}) =>
  route.POST(
    new Request(url, {
      method: 'POST',
      headers: json
        ? { ...headers, 'content-type': 'application/json' }
        : headers,
      body: json ? JSON.stringify(json) : new URLSearchParams(form ?? {}),
    }),
    { params: Promise.resolve({ callId }) },
  );

// --- the answer URL ---------------------------------------------------------------

// An unsigned POST — what anyone on the internet can send — gets no XML.
equal((await post(answer, ANSWER_URL, 'call_1')).status, 401);

// A signature made with some other workspace's token is not this workspace's.
equal(
  (
    await post(answer, ANSWER_URL, 'call_1', {
      headers: signed(ANSWER_URL, 'n1', 'another-workspace-token'),
    })
  ).status,
  401,
);

// A real one.
const accepted = await post(answer, ANSWER_URL, 'call_1', {
  headers: signed(ANSWER_URL, 'n2'),
  form: { CallUUID: 'vobiz-uuid-1', From: '911244982201', To: '919812345678' },
});
equal(accepted.status, 200);

// The live app sits behind a reverse proxy. Even when Request.url has the
// internal origin, the public URL Vobiz signed must authenticate.
const proxiedAccepted = await post(
  answer,
  'http://127.0.0.1:3000/api/webhooks/telephony/vobiz/answer/call_1',
  'call_1',
  {
    headers: signed(ANSWER_URL, 'n2-proxy'),
    form: { CallUUID: 'vobiz-uuid-1' },
  },
);
equal(proxiedAccepted.status, 200);
equal(accepted.headers.get('content-type'), 'text/xml; charset=utf-8');
const xml = await accepted.text();
ok(xml.includes('<Stream '), 'the answer document streams the call');
// The gateway is one host for the whole platform, so the XML has to say which
// call the socket it is about to receive belongs to.
ok(
  xml.includes('callId=call_1') || xml.includes('callId%3Dcall_1'),
  'the stream URL names the call',
);
ok(
  xml.includes('token=gateway-secret-for-test') ||
    xml.includes('token%3Dgateway-secret-for-test'),
  'the carrier stream authenticates to the media gateway',
);
ok(
  xml.includes('/status/call_1'),
  'the stream status callback points back at this call',
);
// Their platform fetches this only once the call is answered, so the fetch is
// the evidence: a call that was queued is now live.
equal(
  sqlite.prepare("SELECT status FROM call_records WHERE id = 'call_1'").get()
    .status,
  'in_progress',
);

// A call id that belongs to no call gets a 404 and — the part that matters —
// gets it *before* any credential is read, so this door cannot be used to ask
// whether a given call exists in some other workspace.
equal((await post(answer, ANSWER_URL, 'call_missing')).status, 404);

// A workspace with no Vobiz credentials verifies nothing, and therefore
// accepts nothing. An empty token must not mean an empty signature passes.
equal(
  (
    await post(
      answer,
      'https://vaani.test/api/webhooks/telephony/vobiz/answer/call_2',
      'call_2',
      {
        headers: {
          'X-Vobiz-Signature-V3': '',
          'X-Vobiz-Signature-V3-Nonce': '',
        },
      },
    )
  ).status,
  401,
);

// --- the status URL ---------------------------------------------------------------

equal((await post(statusRoute, STATUS_URL, 'call_1')).status, 401);

// Ringing. Nothing is billed and the call is not finished.
equal(
  (
    await post(statusRoute, STATUS_URL, 'call_1', {
      headers: signed(STATUS_URL, 'n3'),
      form: {
        Event: 'Ring',
        CallStatus: 'ringing',
        CallUUID: 'vobiz-uuid-1',
        SessionStart: '2026-09-12T06:00:00Z',
      },
    })
  ).status,
  200,
);
equal(settlements.length, 0, 'a ringing phone is not a bill');
equal(
  sqlite.prepare("SELECT ended_at FROM call_records WHERE id = 'call_1'").get()
    .ended_at,
  null,
);

// Stream lifecycle callbacks share the URL but are not call lifecycle events.
// StartStream used to normalise its missing CallStatus to `processing` and
// overwrite the `in_progress` written by the answer callback.
const streamStarted = await post(statusRoute, STATUS_URL, 'call_1', {
  headers: signed(STATUS_URL, 'n3-stream'),
  form: {
    Event: 'StartStream',
    CallUUID: 'vobiz-uuid-1',
    StreamID: 'stream-1',
  },
});
equal(streamStarted.status, 200);
equal(
  sqlite.prepare("SELECT status FROM call_records WHERE id = 'call_1'").get()
    .status,
  'ringing',
  'stream telemetry does not overwrite call lifecycle status',
);
await post(statusRoute, STATUS_URL, 'call_1', {
  headers: signed(STATUS_URL, 'n3-played'),
  form: {
    Event: 'PlayedStream',
    CallUUID: 'vobiz-uuid-1',
    StreamID: 'stream-1',
    Name: 'callvani-1',
  },
});
equal(
  sqlite.prepare("SELECT status FROM call_records WHERE id = 'call_1'").get()
    .status,
  'ringing',
  'played-stream acknowledgement also preserves lifecycle status',
);

// Hangup, two minutes and two seconds of talk after nine seconds of ringing.
const hangup = {
  Event: 'Hangup',
  CallStatus: 'completed',
  CallUUID: 'vobiz-uuid-1',
  From: '911244982201',
  To: '919812345678',
  StartTime: '2026-09-12T06:00:00Z',
  AnswerTime: '2026-09-12T06:00:09Z',
  EndTime: '2026-09-12T06:02:11Z',
};
equal(
  (
    await post(statusRoute, STATUS_URL, 'call_1', {
      headers: signed(STATUS_URL, 'n4'),
      form: hangup,
    })
  ).status,
  200,
);
const settled = sqlite
  .prepare("SELECT * FROM call_records WHERE id = 'call_1'")
  .get();
equal(settled.status, 'completed');
// 122 seconds of talk — not 131, which is what billing the ring would cost the
// customer.
equal(settled.duration_seconds, 122);
equal(settled.ended_at, '2026-09-12T06:02:11Z', 'their clock, not ours');
equal(settlements.length, 1, 'billed once');
equal(settlements[0].credits, 3, 'three started minutes');
equal(
  campaignSettlements[0].callId,
  'call_1',
  'terminal webhook settles its campaign contact',
);
equal(
  campaignSettlements[0].status,
  'completed',
  'campaign settlement sees terminal outcome',
);
equal(
  JSON.parse(settled.analysis_json).providerReference,
  'vobiz-uuid-1',
  'the call can be found in their CDRs',
);

// The generic callback contract sends `Status`, and a Hangup may carry only
// its generic timestamp. It must still close the call and retain the carrier's
// disconnect reason instead of leaving a permanent processing row.
const genericStatusUrl =
  'https://vaani.test/api/webhooks/telephony/vobiz/status/call_3';
equal(
  (
    await post(statusRoute, genericStatusUrl, 'call_3', {
      headers: signed(genericStatusUrl, 'n4-generic'),
      form: {
        Event: 'Hangup',
        Status: 'completed',
        CallUUID: 'vobiz-uuid-3',
        timestamp: '2026-09-12T06:05:00Z',
        Duration: '109',
        HangupCauseName: 'Normal Hangup',
      },
    })
  ).status,
  200,
);
const genericSettled = sqlite
  .prepare("SELECT * FROM call_records WHERE id = 'call_3'")
  .get();
equal(genericSettled.status, 'completed');
equal(genericSettled.ended_at, '2026-09-12T06:05:00Z');
equal(genericSettled.disconnect_reason, 'Normal Hangup');
equal(genericSettled.duration_seconds, 109);
equal(
  settlements.length,
  1,
  'ambiguous total duration updates history but never bills as talk time',
);

// Event=Hangup alone is terminal even when neither callback timestamp field is
// present. The server receipt time is the last-resort end time, so the row can
// never remain permanently live after an authoritative hangup.
const timestampFreeStatusUrl =
  'https://vaani.test/api/webhooks/telephony/vobiz/status/call_4';
equal(
  (
    await post(statusRoute, timestampFreeStatusUrl, 'call_4', {
      headers: signed(timestampFreeStatusUrl, 'n4-no-time'),
      form: {
        Event: 'Hangup',
        CallUUID: 'vobiz-uuid-4',
      },
    })
  ).status,
  200,
);
const timestampFreeSettled = sqlite
  .prepare("SELECT * FROM call_records WHERE id = 'call_4'")
  .get();
equal(timestampFreeSettled.status, 'completed');
ok(timestampFreeSettled.ended_at, 'server receipt time closes timestamp-free hangup');
equal(timestampFreeSettled.duration_seconds, 0);
equal(settlements.length, 1, 'timestamp-free zero-talk hangup is not billed');

// Their platform retries any non-200 three times, and retries arrive late and
// out of order. The same hangup again must not bill again.
await post(statusRoute, STATUS_URL, 'call_1', {
  headers: signed(STATUS_URL, 'n5'),
  form: hangup,
});
equal(settlements.length, 1, 'a retried callback is not a second bill');

// A late `ringing` after a completed call must not put it back on the air.
await post(statusRoute, STATUS_URL, 'call_1', {
  headers: signed(STATUS_URL, 'n6'),
  form: { Event: 'Ring', CallStatus: 'ringing', CallUUID: 'vobiz-uuid-1' },
});
const afterLateRing = sqlite
  .prepare(
    "SELECT status, duration_seconds FROM call_records WHERE id = 'call_1'",
  )
  .get();
equal(afterLateRing.status, 'completed', 'a finished call stays finished');
equal(afterLateRing.duration_seconds, 122, 'and keeps the duration it had');

// JSON rather than form encoding, because their documentation shows both.
equal(
  (
    await post(
      statusRoute,
      'https://vaani.test/api/webhooks/telephony/vobiz/status/call_2',
      'call_2',
      {
        headers: signed(
          'https://vaani.test/api/webhooks/telephony/vobiz/status/call_2',
          'n7',
          '',
        ),
        json: { CallStatus: 'completed', CallUUID: 'x' },
      },
    )
  ).status,
  401,
  'an unconfigured workspace still verifies nothing',
);

// A signed callback with no call reference in it names no call, so there is
// nothing to settle — and settling the call from the path instead would let a
// body that says nothing close a call that is still up.
equal(
  (
    await post(statusRoute, STATUS_URL, 'call_1', {
      headers: signed(STATUS_URL, 'n8'),
      form: { Event: 'Hangup' },
    })
  ).status,
  400,
);

// Nothing here billed anyone twice or wrote into the other workspace.
equal(
  sqlite
    .prepare("SELECT cost_credits FROM call_records WHERE id = 'call_2'")
    .get().cost_credits,
  0,
);

sqlite.close();
console.log(
  `vobiz webhooks: ${checks} assertions passed (in-memory SQLite; no provider contacted).`,
);
