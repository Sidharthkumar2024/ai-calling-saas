import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};

const encryptionKey = 'operator-test-encryption-key-32-bytes-minimum';

function toBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

async function encryptSecret(value) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(encryptionKey),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(encrypted)}`;
}

function runOperator(script, databasePath, extraEnvironment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, '+919999999999'], {
      env: {
        ...process.env,
        CALLVANI_OPERATOR_TEST: 'YES',
        CALLVANI_SQLITE_PATH: databasePath,
        PUBLIC_BASE_URL: 'https://callvani.test',
        VOICE_STREAM_URL: 'wss://callvani.test/media-stream/',
        VAANI_ENCRYPTION_KEY: encryptionKey,
        CALLVANI_TEST_ORG_ID: '',
        ...extraEnvironment,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const directory = mkdtempSync(join(tmpdir(), 'callvani-operator-test-'));
const databasePath = join(directory, 'app.sqlite');
const database = new DatabaseSync(databasePath);
const requests = [];
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  requests.push({
    path: request.url,
    body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
  });
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ request_uuid: 'vobiz_target_call' }));
});

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const encrypted = await encryptSecret({ apiKey: 'test-vobiz-token' });

  database.exec(`
    CREATE TABLE voice_agents (
      id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, status TEXT
    );
    CREATE TABLE number_routes (
      id TEXT PRIMARY KEY, organization_id TEXT, number_id TEXT, agent_id TEXT,
      status TEXT, priority INTEGER, created_at TEXT
    );
    CREATE TABLE phone_numbers (
      id TEXT PRIMARY KEY, organization_id TEXT, phone_number TEXT, status TEXT,
      provider_code TEXT, direction TEXT
    );
    CREATE TABLE integration_connections (
      id TEXT PRIMARY KEY, organization_id TEXT, type TEXT, status TEXT,
      public_config_json TEXT, encrypted_secret TEXT
    );
    CREATE TABLE platform_provider_secrets (
      provider TEXT PRIMARY KEY, encrypted_secret TEXT
    );
    CREATE TABLE call_records (
      id TEXT PRIMARY KEY, organization_id TEXT, agent_id TEXT, direction TEXT,
      channel TEXT, from_number TEXT, to_number TEXT, status TEXT, outcome TEXT,
      recording_status TEXT, started_at TEXT, analysis_json TEXT,
      provider_reference TEXT, disconnect_reason TEXT, ended_at TEXT
    );
  `);
  const addRoute = ({ suffix, organizationId, priority, phoneNumber }) => {
    database
      .prepare(`INSERT INTO voice_agents VALUES (?, ?, 'Aarohi', 'active')`)
      .run(`agent_${suffix}`, organizationId);
    database
      .prepare(
        `INSERT INTO phone_numbers VALUES (?, ?, ?, 'active', 'vobiz', 'inbound_outbound')`,
      )
      .run(`number_${suffix}`, organizationId, phoneNumber);
    database
      .prepare(
        `INSERT INTO number_routes VALUES (?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP)`,
      )
      .run(
        `route_${suffix}`,
        organizationId,
        `number_${suffix}`,
        `agent_${suffix}`,
        priority,
      );
    database
      .prepare(
        `INSERT INTO integration_connections VALUES (?, ?, 'telephony_vobiz', 'connected', ?, ?)`,
      )
      .run(
        `connection_${suffix}`,
        organizationId,
        JSON.stringify({ accountId: `MA_${suffix}`, baseUrl }),
        encrypted,
      );
  };

  // The other customer deliberately has the globally better priority. An
  // unscoped query would place their call; the operator-selected org must win.
  addRoute({
    suffix: 'wrong',
    organizationId: 'org_wrong',
    priority: 0,
    phoneNumber: '+911111111111',
  });
  addRoute({
    suffix: 'target',
    organizationId: 'org_target',
    priority: 10,
    phoneNumber: '+912222222222',
  });
  database.exec(`
    INSERT INTO platform_provider_secrets VALUES ('deepgram', 'configured');
    INSERT INTO platform_provider_secrets VALUES ('cartesia', 'configured');
  `);

  const script = fileURLToPath(
    new URL('./run-operator-voice-test.mjs', import.meta.url),
  );
  const missingOrg = await runOperator(script, databasePath);
  equal(
    missingOrg.code,
    2,
    'an operator call without an explicit customer org is refused',
  );
  ok(
    missingOrg.stderr.includes('CALLVANI_TEST_ORG_ID'),
    'the refusal names the missing safety input',
  );
  equal(requests.length, 0, 'the refused call never reaches Vobiz');

  const result = await runOperator(script, databasePath, {
    CALLVANI_TEST_ORG_ID: 'org_target',
  });
  equal(result.code, 0, result.stderr || 'the customer-scoped call succeeds');
  const output = JSON.parse(result.stdout);
  equal(
    output.organizationId,
    'org_target',
    'the result names the selected customer',
  );
  equal(requests.length, 1, 'only one carrier request is made');
  equal(
    requests[0].path,
    '/api/v1/Account/MA_target/Call/',
    'the selected customer account is used',
  );
  equal(
    requests[0].body.from,
    '912222222222',
    'the selected customer number is used',
  );
  const call = database
    .prepare('SELECT organization_id, agent_id, from_number FROM call_records')
    .get();
  equal(
    call.organization_id,
    'org_target',
    'the call record stays in the selected customer',
  );
  equal(
    call.agent_id,
    'agent_target',
    'the selected customer agent owns the call',
  );
  equal(
    call.from_number,
    '+912222222222',
    'the selected customer number is persisted',
  );

  console.log(`${checks} operator voice test safety checks passed`);
} finally {
  database.close();
  await new Promise((resolve) => server.close(resolve));
  rmSync(directory, { recursive: true, force: true });
}
