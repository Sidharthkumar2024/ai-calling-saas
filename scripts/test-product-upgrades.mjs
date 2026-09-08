import assert from 'node:assert/strict';
import { Script, compileFunction } from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import { sha256 } from '../lib/security.ts';
import {
  businessStepError,
  firstBusinessStep,
} from '../lib/business-onboarding.ts';
import {
  splitProviderConfig,
  decodeProviderSecret,
} from '../lib/provider-secret-policy.ts';
import {
  validateLeadFields,
  collectLeadFields,
  DEFAULT_LEAD_FIELDS,
  safeLogo,
} from '../lib/lead-form-fields.ts';
import { leadWidgetSource } from '../lib/lead-widget-source.ts';
import { deepgramTranscript } from '../lib/deepgram-stt.ts';
import { benchmarkMinute } from '../lib/pricing-reference.ts';
import { replyWindow } from '../lib/whatsapp-inbox.ts';

let checks = 0;
const equal = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
const match = (actual, pattern) => {
  assert.match(actual, pattern);
  checks++;
};
const throws = (fn) => {
  assert.throws(fn);
  checks++;
};
const answers = {
  company: 'VANI',
  business: 'Voice software',
  website: 'https://example.com',
  ideal_customer: 'Small businesses',
  competitors: '',
  goals: 'Book appointments',
  lead_definition: 'A customer asking for a demo',
};
equal(firstBusinessStep({}), 0);
equal(firstBusinessStep({ company: 'VANI', business: 'Software' }), 1);
equal(
  firstBusinessStep({
    company: 'VANI',
    business: 'Software',
    ideal_customer: 'Businesses',
  }),
  2,
);
for (let step = 0; step < 3; step++)
  equal(businessStepError(step, answers), null);
equal(
  Boolean(businessStepError(0, { ...answers, website: 'javascript:alert(1)' })),
  true,
);
equal(Boolean(businessStepError(0, { ...answers, company: null })), true);
equal(
  splitProviderConfig({
    appId: 'public',
    appSecret: 'private',
    webhookSecret: 'webhook',
    apiKey: 'key',
  }),
  {
    config: { appId: 'public' },
    secrets: { appSecret: 'private', webhookSecret: 'webhook', apiKey: 'key' },
  },
);
equal(splitProviderConfig({ appSecret: '' }).secrets, {});
equal(decodeProviderSecret('legacy-key'), { apiKey: 'legacy-key' });
equal(decodeProviderSecret('{"apiKey":"key","webhookSecret":"sign"}'), {
  apiKey: 'key',
  webhookSecret: 'sign',
});
equal(decodeProviderSecret('{"webhookSecret":"sign"}').apiKey, undefined);
equal(validateLeadFields(DEFAULT_LEAD_FIELDS), DEFAULT_LEAD_FIELDS);
throws(() => validateLeadFields([]));
throws(() =>
  validateLeadFields([...DEFAULT_LEAD_FIELDS, DEFAULT_LEAD_FIELDS[0]]),
);
throws(() =>
  validateLeadFields([
    ...DEFAULT_LEAD_FIELDS,
    { key: 'sourceType', label: 'bad' },
  ]),
);
throws(() =>
  validateLeadFields([
    ...DEFAULT_LEAD_FIELDS,
    { key: '__proto__', label: 'bad' },
  ]),
);
const fields = validateLeadFields([
  ...DEFAULT_LEAD_FIELDS,
  { key: 'budget', type: 'number', label: 'Budget', required: true },
]);
equal(
  collectLeadFields(fields, {
    name: 'Test',
    phone: '+919876543210',
    budget: '42',
    ignore: 'not saved',
  }).budget,
  '42',
);
throws(() =>
  collectLeadFields(fields, { name: 'Test', phone: '+919876543210' }),
);
throws(() =>
  collectLeadFields(fields, {
    name: 'Test',
    phone: '+919876543210',
    budget: 'oops',
  }),
);
throws(() =>
  collectLeadFields(fields, { name: 'Test', phone: 'bad phone', budget: '42' }),
);
throws(() => collectLeadFields(fields, null));
throws(() =>
  collectLeadFields(fields, {
    name: 'Test',
    phone: '+919876543210',
    email: '<bad>',
    budget: '42',
  }),
);
equal(safeLogo('javascript:alert(1)'), '');
equal(safeLogo('https://example.com/logo.png'), 'https://example.com/logo.png');
equal(safeLogo('https://user:secret@example.com/logo.png'), '');
const source = leadWidgetSource({
  publicKey: 'test',
  endpoint: 'http://localhost/api/test',
  fields,
  settings: { title: '</script><script>bad()</script>', trigger: 'manual' },
});
new Script(source);
checks++;
equal(source.includes('</script>'), false);
equal(source.includes('VaaniLeadForms[c.publicKey]'), true);
equal(replyWindow({ lastInboundAt: '2999-01-01T00:00:00Z' }).open, false);
equal(replyWindow({ lastInboundAt: 'not a timestamp' }).open, false);
equal(Math.round(benchmarkMinute(90, 17).bufferedCost * 1000), 9339);
equal(benchmarkMinute(0, 17), null);

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options) => {
    equal(new URL(url).searchParams.get('language'), 'hi');
    equal(options.headers.authorization, 'Token synthetic-key');
    equal(options.method, 'POST');
    return Response.json({
      metadata: { duration: 6, request_id: 'synthetic' },
      results: { channels: [{ alternatives: [{ transcript: ' नमस्ते ' }] }] },
    });
  };
  const result = await deepgramTranscript(
    { audio: new ArrayBuffer(2), languageCode: 'hi-IN' },
    'synthetic-key',
  );
  equal(result.transcript, 'नमस्ते');
  equal(result.durationSeconds, 6);
  globalThis.fetch = async () =>
    Response.json({ error: 'nope' }, { status: 401 });
  await assert.rejects(
    () => deepgramTranscript({ audio: new ArrayBuffer(2) }, 'synthetic-key'),
    /401/,
  );
  checks++;
} finally {
  globalThis.fetch = originalFetch;
}

// Exercise the actual inbox route with synthetic auth/data. Never sends a real message.
let saved = 0,
  sends = 0,
  templateSends = 0,
  connected = true,
  templateRow = null,
  inbound = new Date().toISOString();
const sql = {
  prepare(query) {
    return {
      bind() {
        return this;
      },
      async all() {
        return {
          results: [
            {
              id: 'out',
              sender_phone: '+919876543210',
              direction: 'outbound',
              message_type: 'text',
              body: 'old',
              created_at: new Date().toISOString(),
            },
          ],
        };
      },
      async first() {
        // The template lookup and the inbound-window read are both `first()`
        // on this fake, so they are told apart by what was asked for.
        if (/FROM whatsapp_templates/.test(query)) return templateRow;
        return { last_at: inbound };
      },
      async run() {
        saved++;
      },
    };
  },
};
const modules = {
  'next/server': {
    NextResponse: { json: (body, init) => Response.json(body, init) },
  },
  '@/db/bootstrap': { ensureSchema: async () => {} },
  '@/db/index': { getRawDb: () => sql },
  '@/lib/customer-rbac': {
    requireAnyCustomerPermission: async () => ({
      session: { organizationId: 'synthetic-org' },
    }),
  },
  '@/lib/demo-seed': { recordAudit: async () => {} },
  '@/lib/commerce': {
    whatsAppConnected: async () => connected,
    sendWhatsAppText: async () => {
      sends++;
      return { status: 'sent', providerReference: 'synthetic-message' };
    },
    sendWhatsAppTemplate: async () => {
      templateSends++;
      return { status: 'sent', providerReference: 'synthetic-template' };
    },
  },
  '@/lib/whatsapp-inbox': await import('../lib/whatsapp-inbox.ts'),
  '@/lib/whatsapp-templates': await import('../lib/whatsapp-templates.ts'),
};
const route = {};
compileFunction(
  ts.transpileModule(
    readFileSync(
      new URL('../app/api/app/whatsapp-inbox/route.ts', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  ['require', 'exports'],
)((id) => {
  if (!modules[id]) throw Error(id);
  return modules[id];
}, route);
const reply = (data) =>
  route.POST(
    new Request('http://localhost/api/app/whatsapp-inbox', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }),
  );
for (const data of [
  null,
  [],
  { phone: {}, text: 'Hi' },
  { phone: '+919876543210', text: {} },
  { phone: '+919876543210', text: 'x'.repeat(4001) },
])
  equal((await reply(data)).status, 400);
connected = false;
equal((await reply({ phone: '+919876543210', text: 'Hi' })).status, 409);
equal(sends, 0);
connected = true;
inbound = '2020-01-01 00:00:00';
equal((await reply({ phone: '+919876543210', text: 'Hi' })).status, 409);
equal(sends, 0);
inbound = new Date().toISOString();
equal((await reply({ phone: '+919876543210', text: 'Hi' })).status, 200);
equal(sends, 1);
equal(saved, 1);

// Templates: the answer to a closed window, not a way around it.
const approved = {
  id: 'wt_1',
  name: 'appointment_reminder',
  language: 'en',
  category: 'UTILITY',
  header: null,
  body: 'Hello {{1}}, your visit is on {{2}}.',
  footer: null,
  status: 'APPROVED',
  provider_id: 'meta_1',
  rejected_reason: null,
};
const sendTemplate = (data) =>
  reply({ action: 'send_template', phone: '+919876543210', ...data });
templateRow = null;
equal((await sendTemplate({ templateId: 'wt_missing' })).status, 404);
// A template still in review cannot be sent, whatever the screen believed.
templateRow = { ...approved, status: 'PENDING' };
equal((await sendTemplate({ templateId: 'wt_1', params: ['A', 'B'] })).status, 409);
templateRow = approved;
equal((await sendTemplate({ templateId: 'wt_1', params: ['A'] })).status, 400);
equal((await sendTemplate({ templateId: 'wt_1', params: ['A', 'two\nlines'] })).status, 400);
equal(templateSends, 0);
connected = false;
equal((await sendTemplate({ templateId: 'wt_1', params: ['A', 'B'] })).status, 409);
equal(templateSends, 0);
connected = true;
// The window is closed and this still goes, which is the whole point.
inbound = '2020-01-01 00:00:00';
const savedBefore = saved;
equal((await sendTemplate({ templateId: 'wt_1', params: ['Asha', 'Tuesday'] })).status, 200);
equal(templateSends, 1);
equal(saved, savedBefore + 1);
templateRow = null;
inbound = new Date().toISOString();
// Actual commerce adapter: tenant routing, structured encrypted token decoding,
// canonical phone matching, suppression and no cross-workspace sender fallback.
const commerceDb = new DatabaseSync(':memory:');
commerceDb.exec(`CREATE TABLE integration_connections(organization_id TEXT, type TEXT, public_config_json TEXT, encrypted_secret TEXT, status TEXT); CREATE TABLE whatsapp_messages(organization_id TEXT, sender_phone TEXT, direction TEXT, created_at TEXT); CREATE TABLE suppression_entries(id TEXT, phone_hash TEXT, organization_id TEXT, scope TEXT, expires_at TEXT);`);
function dbStatement(query, args = []) { return { bind(...values) { return dbStatement(query, values); }, async first() { return commerceDb.prepare(query).get(...args) ?? null; }, async all() { return { results: commerceDb.prepare(query).all(...args) }; } }; }
const commerceModules = { '@/db/index': { getRawDb: () => ({ prepare: dbStatement }) }, '@/lib/security': { decryptSecret: async value => value, sha256 }, '@/lib/provider-secret-policy': { decodeProviderSecret }, '@/lib/platform-secrets': { readPlatformSecret: async () => ({ disabled: false, config: {}, secrets: {} }) }, '@/lib/whatsapp-inbox': { replyWindow } };
const commerce = {};
let commerceFetches = 0;
const commerceEnv = { WHATSAPP_ACCESS_TOKEN: 'platform-token', WHATSAPP_PHONE_NUMBER_ID: '123456', WHATSAPP_DEFAULT_ORGANIZATION_ID: 'org_A' };
compileFunction(ts.transpileModule(readFileSync(new URL('../lib/commerce.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, ['require', 'exports', 'fetch', 'process'])(id => { if (!commerceModules[id]) throw Error(id); return commerceModules[id]; }, commerce, async (url, options) => { commerceFetches++; equal(options.headers.authorization, 'Bearer tenant-token'); equal(url, 'https://graph.facebook.com/v23.0/123456/messages'); return Response.json({ messages: [{ id: 'synthetic-wa-id' }] }); }, { env: commerceEnv });
commerceDb.prepare('INSERT INTO integration_connections VALUES (?,?,?,?,?)').run('org_A', 'whatsapp_cloud', '{"accountId":"123456"}', '{"apiKey":"tenant-token"}', 'connected');
commerceDb.prepare('INSERT INTO whatsapp_messages VALUES (?,?,?,?)').run('org_A', '919876543210', 'inbound', new Date().toISOString());
equal((await commerce.whatsAppInboundCredentials('123456')).accessToken, 'tenant-token');
equal(await commerce.whatsAppConnected('org_B'), false);
equal((await commerce.sendWhatsAppText({ organizationId: 'org_A', destination: '+919876543210', body: 'Hello' })).status, 'sent');
equal(commerceFetches, 1);
// A template is what WhatsApp accepts once the window has closed, so this
// sender deliberately does not check the window — proven by closing it.
commerceDb.prepare('DELETE FROM whatsapp_messages').run();
await assert.rejects(() => commerce.sendWhatsAppText({ organizationId: 'org_A', destination: '+919876543210', body: 'Hello' }), /approved template/i); checks++;
equal((await commerce.sendWhatsAppTemplate({ organizationId: 'org_A', destination: '+919876543210', name: 'appointment_reminder', language: 'en', params: ['Asha', 'Tuesday'] })).status, 'sent');
equal(commerceFetches, 2);
// Templates live on the business account, so a workspace can be able to send
// and still be unable to manage them. Those are different sentences.
equal((await commerce.whatsAppTemplateAccess('org_A')).ok, false);
match((await commerce.whatsAppTemplateAccess('org_A')).reason, /Business Account ID/);
match((await commerce.whatsAppTemplateAccess('org_unconnected')).reason, /Integrations/);
commerceDb.prepare('INSERT INTO suppression_entries VALUES (?,?,?,?,NULL)').run('block', await sha256('+919876543210'), 'org_A', 'organization');
await assert.rejects(() => commerce.sendWhatsAppText({ organizationId: 'org_A', destination: '919876543210', body: 'Hello' }), /do-not-contact/); checks++;
// Someone who asked not to be contacted did not thereby agree to templates.
await assert.rejects(() => commerce.sendWhatsAppTemplate({ organizationId: 'org_A', destination: '919876543210', name: 'appointment_reminder', language: 'en', params: [] }), /do-not-contact/); checks++;
equal(commerceFetches, 2);
commerceDb.prepare('INSERT INTO integration_connections VALUES (?,?,?,?,?)').run('org_B', 'whatsapp_cloud', '{"accountId":"123456"}', '{"apiKey":"other-token"}', 'connected');
equal(await commerce.whatsAppInboundCredentials('123456'), null);
commerceDb.close();
console.log(
  `Product upgrades: ${checks} checks passed; all provider traffic synthetic.`,
);
