import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

const statements = [];
const audits = [];
const database = {
  prepare(sql) {
    return {
      bind(...args) {
        return {
          async run() {
            statements.push({ sql, args });
            return { meta: { changes: 1 } };
          },
          async first() {
            return null;
          },
          async all() {
            return { results: [] };
          },
        };
      },
    };
  },
};

const modules = {
  'next/server': {
    NextResponse: {
      json: (body, init) => Response.json(body, init),
    },
  },
  '@/db/bootstrap': { ensureSchema: async () => undefined },
  '@/db/index': { getRawDb: () => database },
  '@/lib/api-session': {
    requireCustomer: async () => ({
      session: { organizationId: 'org_test', userId: 'user_test' },
      response: null,
    }),
  },
  '@/lib/customer-rbac': {
    requireCustomerPermission: async () => ({
      session: { organizationId: 'org_test', userId: 'user_test' },
      response: null,
    }),
  },
  '@/lib/demo-seed': {
    recordAudit: async (...args) => audits.push(args),
  },
  '@/lib/voice-profiles': { listVoiceProfiles: async () => [] },
  '@/lib/voice-consent': {
    validateConsent: () => ({ ok: false, errors: [] }),
    voiceGate: () => ({ allowed: true }),
  },
};

const route = {};
compileFunction(
  ts.transpileModule(
    readFileSync(
      new URL('../app/api/app/voice-profiles/route.ts', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  ['require', 'exports', 'crypto'],
)(
  (id) => {
    if (!modules[id]) throw new Error(`Unstubbed module: ${id}`);
    return modules[id];
  },
  route,
  globalThis.crypto,
);

const createResponse = await route.POST(
  new Request('https://callvani.test/api/app/voice-profiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Cartesia Hindi',
      presentation: 'female',
      provider: 'cartesia',
      providerVoiceId: 'cartesia_voice_1',
      modelId: 'sonic-3.6',
      allowedLanguages: ['hi-IN', 'en-IN'],
      apiKey: 'customer-key-must-be-ignored',
      baseUrl: 'https://attacker.invalid',
    }),
  }),
);
assert.equal(createResponse.status, 200);
const create = statements.find((statement) =>
  statement.sql.includes('INSERT INTO voice_profiles'),
);
assert.ok(create);
assert.equal(create.args[1], 'org_test');
assert.equal(create.args[4], 'cartesia');
assert.equal(create.args[5], 'cartesia_voice_1');
assert.equal(create.args[6], 'sonic-3.6');
assert.equal(create.args.includes('customer-key-must-be-ignored'), false);
assert.equal(create.args.includes('https://attacker.invalid'), false);
assert.equal(audits.at(-1)[1], 'voice_profile.created');

statements.length = 0;
const updateResponse = await route.PATCH(
  new Request('https://callvani.test/api/app/voice-profiles', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'update',
      profileId: 'voice_cartesia_test',
      providerVoiceId: 'cartesia_voice_2',
      modelId: 'sonic-4',
      apiKey: 'customer-key-must-still-be-ignored',
    }),
  }),
);
assert.equal(updateResponse.status, 200);
const update = statements.find((statement) =>
  statement.sql.includes('UPDATE voice_profiles SET'),
);
assert.ok(update);
assert.match(update.sql, /provider_voice_id = \?/);
assert.match(update.sql, /model_id = \?/);
assert.deepEqual(update.args, [
  'cartesia_voice_2',
  'sonic-4',
  'voice_cartesia_test',
  'org_test',
]);
assert.equal(update.args.includes('customer-key-must-still-be-ignored'), false);
assert.equal(audits.at(-1)[1], 'voice_profile.updated');

const ui = readFileSync(
  new URL('../components/customer-voice-profiles.tsx', import.meta.url),
  'utf8',
);
assert.match(ui, /<option value="cartesia">Cartesia Sonic<\/option>/);
assert.match(ui, /cartesia: 'sonic-3\.6'/);
assert.match(ui, /setModelId\(DEFAULT_MODEL_BY_PROVIDER\[nextProvider\]/);
assert.doesNotMatch(ui, /Customer API key|customerApiKey/);

console.log(
  'Cartesia customer voice profile: create/update/UI assertions passed without customer keys.',
);
