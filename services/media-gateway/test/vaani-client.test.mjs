import assert from 'node:assert/strict';

import { VaaniClient } from '../src/vaani-client.js';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};
const originalFetch = globalThis.fetch;
const client = new VaaniClient({
  baseUrl: 'https://vaani.test',
  secret: 'gateway-test-secret',
  timeoutMs: 1000,
});

try {
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    equal(init.headers['x-vaani-gateway-secret'], 'gateway-test-secret');
    if (calls === 1) throw new TypeError('fetch failed');
    return Response.json({ audioBase64: 'AA==', contentType: 'audio/basic' });
  };
  const greeting = await client.greeting('call_retry');
  equal(calls, 2, 'a greeting retries one transient app transport failure');
  equal(greeting.contentType, 'audio/basic');

  calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  };
  await assert.rejects(client.greeting('call_bad_secret'), /Unauthorized/);
  checks += 1;
  equal(calls, 1, 'a configuration/auth failure is not retried');

  calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ error: 'worker restarting' }, { status: 503 });
  };
  await assert.rejects(
    client.turn('call_turn', Buffer.from('wav')),
    /worker restarting/,
  );
  checks += 1;
  equal(calls, 1, 'a caller turn is not replayed because tools may have run');
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`Vaani client resilience: ${checks} assertions passed.`);
