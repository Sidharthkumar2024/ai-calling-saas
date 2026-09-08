import assert from 'node:assert/strict';

import {
  leadFromFlowAnswers,
  usablePhone,
} from '../lib/whatsapp-flow-leads.ts';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

/**
 * The real lead engine, minus its database.
 *
 * `normalizeLeadInput` is the gate every lead passes through, and the mapper's
 * output is only useful if that gate accepts it — a rejected source type would
 * mean forms quietly stop becoming leads, since the webhook swallows the
 * failure to avoid asking Meta to resend a completed form.
 */
const engine = {};
compileFunction(
  ts.transpileModule(
    readFileSync(new URL('../lib/lead-engine.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  ['require', 'exports'],
)((id) => {
  if (id === 'drizzle-orm') return { and: () => ({}), eq: () => ({}) };
  if (id === '@/db/index') return { getDb: () => ({}) };
  if (id === '@/db/schema') return { leads: {}, leadSources: {}, callJobs: {}, salesOpportunities: {}, leadEvents: {} };
  throw Error(id);
}, engine);
const { isLeadSourceType, leadSourceTypes, normalizeLeadInput } = engine;

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

const build = (answers, over = {}) =>
  leadFromFlowAnswers({
    answers,
    senderPhone: '919812345678',
    flowName: 'Site visit request',
    flowToken: 'tok_1',
    ...over,
  });

// --- a number the dialer could actually call -----------------------------------

check(() => assert.equal(usablePhone('+91 98123 45678'), '+919812345678'));
check(() => assert.equal(usablePhone('919812345678'), '+919812345678'));
check(() => assert.equal(usablePhone('12345'), ''));
check(() => assert.equal(usablePhone('9'.repeat(16)), ''));
check(() => assert.equal(usablePhone(''), ''));
check(() => assert.equal(usablePhone('not a number'), ''));

// --- the mapping ----------------------------------------------------------------

check(() => {
  const lead = build({
    full_name: 'Asha Verma',
    email: 'asha@example.com',
    budget: 'Above 1Cr',
    visit_on: '2026-03-14',
  });
  assert.equal(lead.sourceType, 'whatsapp');
  assert.equal(lead.name, 'Asha Verma');
  assert.equal(lead.phone, '+919812345678');
  assert.equal(lead.email, 'asha@example.com');
  assert.equal(lead.productInterest, 'Above 1Cr');
  assert.equal(lead.campaignName, 'Site visit request');
});
// The send token, so a retried webhook cannot produce a second lead.
check(() => assert.equal(build({ full_name: 'A B' }).externalLeadId, 'tok_1'));

// Recognising a field name is how it reaches a CRM column. Not recognising one
// must not be how it is thrown away.
check(() => {
  const lead = build({
    full_name: 'Asha',
    how_did_you_hear: 'A friend',
    site_id: 'TOWER-B',
  });
  assert.match(lead.notes, /how_did_you_hear: A friend/);
  assert.match(lead.notes, /site_id: TOWER-B/);
  assert.match(lead.notes, /full_name: Asha/);
});
check(() => assert.equal(build({ full_name: 'A', empty_one: '   ' }).notes.includes('empty_one'), false));

// Inventing a name is worse than saying where the lead came from.
check(() => assert.equal(build({ budget: 'Above 1Cr' }).name, 'WhatsApp form · +919812345678'));
check(() => assert.equal(build({ full_name: 'X' }).name, 'WhatsApp form · +919812345678'));
check(() => assert.equal(build({ name: 'Ravi Kumar' }).name, 'Ravi Kumar'));
check(() => assert.equal(build({ customer_name: 'Ravi' }).name, 'Ravi'));
// Most specific first: a form with both should use the fuller one.
check(() => assert.equal(build({ full_name: 'Asha Verma', first_name: 'Asha' }).name, 'Asha Verma'));

// A person who filled in a form on WhatsApp is reachable at the number they
// filled it in from, whatever they typed into a phone field.
check(() =>
  assert.equal(build({ full_name: 'A B', phone: '+911111111111' }).phone, '+919812345678'),
);
check(() =>
  assert.equal(
    build({ full_name: 'A B', phone: '+911111111111' }, { senderPhone: '' }).phone,
    '+911111111111',
  ),
);
// No number at all: a lead nobody can contact is a row that wastes time.
check(() => assert.equal(build({ full_name: 'A B' }, { senderPhone: 'x' }), null));
check(() => assert.equal(build({}, { senderPhone: '' }), null));

check(() => assert.equal(build({ full_name: 'A B' }).email, undefined));
check(() => assert.equal(build({ full_name: 'A B' }).productInterest, undefined));
check(() =>
  assert.equal(build({ full_name: 'A B', looking_for: '3BHK' }).productInterest, '3BHK'),
);
check(() => assert.equal(build({ full_name: 'A B' }, { flowName: '' }).campaignName, 'WhatsApp form'));
// Long answers are trimmed rather than rejected: the CRM columns have limits
// and losing a lead over a talkative customer would be the wrong trade.
check(() => assert.equal(build({ full_name: 'A'.repeat(300) }).name.length, 120));
check(() => assert.ok(build({ story: 'x'.repeat(6000), full_name: 'A B' }).notes.length <= 4000));

// --- the source has to exist for any of this to land ---------------------------

check(() => assert.ok(leadSourceTypes.includes('whatsapp')));
check(() => assert.equal(isLeadSourceType('whatsapp'), true));
check(() => assert.equal(isLeadSourceType('carrier_pigeon'), false));

// The gate every lead passes through has to accept what the mapper produces.
// The webhook swallows a failure here so Meta is not asked to resend a form
// the customer already completed — which means a rejection would be silent.
check(() => {
  const normalised = normalizeLeadInput(
    build({ full_name: 'Asha Verma', email: 'asha@example.com', budget: 'Above 1Cr' }),
  );
  assert.equal(normalised.sourceType, 'whatsapp');
  assert.equal(normalised.name, 'Asha Verma');
  assert.equal(normalised.phone, '+919812345678');
  assert.equal(normalised.email, 'asha@example.com');
});
// Including the fallback name, which is the one a two-letter answer produces.
check(() => {
  const normalised = normalizeLeadInput(build({ budget: 'Above 1Cr' }));
  assert.match(normalised.name, /WhatsApp form/);
});

console.log(`whatsapp flow leads: ${checks} assertions passed`);
