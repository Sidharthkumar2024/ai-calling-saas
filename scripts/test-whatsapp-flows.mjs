import assert from 'node:assert/strict';

import {
  canSendFlow,
  describeFlowStatus,
  isChoice,
  parseFlowReply,
  toFlowJson,
  validateFlow,
} from '../lib/whatsapp-flows.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

const screen = (over = {}) => ({
  id: 'DETAILS',
  title: 'Tell us what you need',
  fields: [
    { name: 'full_name', label: 'Your name', type: 'text', required: true },
    {
      name: 'budget',
      label: 'Budget',
      type: 'dropdown',
      required: true,
      options: ['Under 50L', '50L to 1Cr', 'Above 1Cr'],
    },
  ],
  ...over,
});

const flow = (over = {}) => ({
  name: 'Site visit request',
  ctaLabel: 'Book a visit',
  screens: [screen()],
  ...over,
});

// --- what Meta and the customer will accept ------------------------------------

check(() => assert.deepEqual(validateFlow(flow()), []));
check(() => assert.ok(validateFlow(flow({ name: 'ab' })).some((p) => /3–80/.test(p))));
check(() =>
  assert.ok(validateFlow(flow({ ctaLabel: 'x'.repeat(21) })).some((p) => /button label/.test(p))),
);
check(() => assert.ok(validateFlow(flow({ screens: [] })).some((p) => /1 and 8 screens/.test(p))));
check(() =>
  assert.ok(
    validateFlow(flow({ screens: [screen({ id: 'details' })] })).some((p) =>
      /Screen ids are capitals/.test(p),
    ),
  ),
);
check(() =>
  assert.ok(
    validateFlow(flow({ screens: [screen(), screen()] })).some((p) =>
      /Two screens are both called DETAILS/.test(p),
    ),
  ),
);
check(() =>
  assert.ok(validateFlow(flow({ screens: [screen({ title: '' })] })).some((p) => /heading/.test(p))),
);
check(() =>
  assert.ok(
    validateFlow(flow({ screens: [screen({ fields: [] })] })).some((p) => /1 and 12 questions/.test(p)),
  ),
);
check(() =>
  assert.ok(
    validateFlow(
      flow({ screens: [screen({ fields: [{ name: 'Full_Name', label: 'x', type: 'text', required: true }] })] }),
    ).some((p) => /Answer names are lowercase/.test(p)),
  ),
);
// The answers arrive in one flat object, so a shared name means one silently
// overwrites the other.
check(() =>
  assert.ok(
    validateFlow(
      flow({
        screens: [
          screen(),
          screen({
            id: 'MORE',
            fields: [{ name: 'full_name', label: 'Name again', type: 'text', required: false }],
          }),
        ],
      }),
    ).some((p) => /both save their answer as full_name/.test(p)),
  ),
);
check(() =>
  assert.ok(
    validateFlow(
      flow({ screens: [screen({ fields: [{ name: 'x', label: 'X', type: 'signature', required: false }] })] }),
    ).some((p) => /not a kind of question/.test(p)),
  ),
);
// A list with nothing to choose from is a required question nobody can answer.
check(() =>
  assert.ok(
    validateFlow(
      flow({ screens: [screen({ fields: [{ name: 'budget', label: 'Budget', type: 'dropdown', required: true, options: ['One'] }] })] }),
    ).some((p) => /at least two different choices/.test(p)),
  ),
);
check(() => assert.equal(isChoice('dropdown'), true));
check(() => assert.equal(isChoice('radio'), true));
check(() => assert.equal(isChoice('checkbox'), true));
check(() => assert.equal(isChoice('text'), false));
check(() => assert.equal(isChoice('opt_in'), false));

// --- the Flow JSON --------------------------------------------------------------

check(() => {
  const json = toFlowJson({ screens: [screen()] });
  assert.equal(json.version, '5.0');
  assert.equal(json.screens.length, 1);
  assert.equal(json.screens[0].terminal, true);
});
check(() => {
  const children = toFlowJson({ screens: [screen()] }).screens[0].layout.children[0].children;
  assert.equal(children[0].type, 'TextInput');
  assert.equal(children[1].type, 'Dropdown');
  assert.deepEqual(
    children[1]['data-source'].map((o) => o.title),
    ['Under 50L', '50L to 1Cr', 'Above 1Cr'],
  );
});
// A screen with no way off it is a customer stuck inside WhatsApp.
check(() => {
  const two = toFlowJson({
    screens: [
      screen(),
      screen({ id: 'CONTACT', fields: [{ name: 'phone_number', label: 'Phone', type: 'phone', required: true }] }),
    ],
  });
  const first = two.screens[0].layout.children[0].children;
  const second = two.screens[1].layout.children[0].children;
  assert.equal(first[first.length - 1]['on-click-action'].name, 'navigate');
  assert.equal(first[first.length - 1]['on-click-action'].next.name, 'CONTACT');
  assert.equal(second[second.length - 1]['on-click-action'].name, 'complete');
  assert.equal(two.screens[0].terminal, undefined);
  assert.equal(two.screens[1].terminal, true);
});
// The completion payload carries every answer from every screen, or the ones
// from screen one never reach the business.
check(() => {
  const two = toFlowJson({
    screens: [
      screen(),
      screen({ id: 'CONTACT', fields: [{ name: 'phone_number', label: 'Phone', type: 'phone', required: true }] }),
    ],
  });
  const last = two.screens[1].layout.children[0].children.at(-1);
  assert.deepEqual(Object.keys(last['on-click-action'].payload).sort(), [
    'budget',
    'full_name',
    'phone_number',
  ]);
});
check(() => {
  const children = toFlowJson({
    screens: [screen({ fields: [{ name: 'age', label: 'Age', type: 'number', required: false }] })],
  }).screens[0].layout.children[0].children;
  assert.equal(children[0]['input-type'], 'number');
});

// --- what comes back -------------------------------------------------------------

const reply = (body) => parseFlowReply({ response_json: JSON.stringify(body) });

check(() =>
  assert.deepEqual(reply({ flow_token: 'tok_1', full_name: 'Asha', budget: '50L to 1Cr' }), {
    flowToken: 'tok_1',
    answers: { full_name: 'Asha', budget: '50L to 1Cr' },
  }),
);
// Everything in here came from a phone, so nothing is trusted to be a string.
check(() => assert.equal(reply({ flow_token: 't', age: 34 }).answers.age, '34'));
check(() => assert.equal(reply({ flow_token: 't', agreed: true }).answers.agreed, 'yes'));
check(() => assert.equal(reply({ flow_token: 't', agreed: false }).answers.agreed, ''));
check(() =>
  assert.equal(reply({ flow_token: 't', areas: ['Andheri', 'Bandra'] }).answers.areas, 'Andheri, Bandra'),
);
// A choice comes back as {id, title} on some component versions; the title is
// what the customer actually read.
check(() =>
  assert.equal(reply({ flow_token: 't', budget: { id: 'b_1', title: 'Above 1Cr' } }).answers.budget, 'Above 1Cr'),
);
check(() => assert.equal(reply({ flow_token: 't', junk: { nothing: 1 } }).answers.junk, ''));
// Keys that are not answer names are not answers.
check(() => assert.equal(reply({ flow_token: 't', 'Bad Key': 'x' }).answers['Bad Key'], undefined));
// A key from a phone must not become a prototype.
check(() => {
  const answers = parseFlowReply({
    response_json: '{"flow_token":"t","__proto__":{"polluted":1},"ok_field":"v"}',
  }).answers;
  assert.equal(Object.hasOwn(answers, '__proto__'), false);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(Object.keys(answers), ['ok_field']);
});
check(() => assert.equal(parseFlowReply({ response_json: 'not json' }), null));
check(() => assert.equal(parseFlowReply({ response_json: '[1,2]' }), null));
check(() => assert.equal(parseFlowReply({}), null));
check(() => assert.equal(parseFlowReply(null), null));
check(() => assert.equal(reply({ full_name: 'Asha' }).flowToken, ''));

// --- sending ---------------------------------------------------------------------

const flowRow = (status) => ({
  id: 'wf_1',
  name: 'Site visit request',
  screens: [screen()],
  status,
  provider_id: '123',
  cta_label: 'Book a visit',
});
check(() => assert.equal(canSendFlow(flowRow('PUBLISHED')), true));
check(() => assert.equal(canSendFlow(flowRow('DRAFT')), false));
check(() => assert.equal(canSendFlow(flowRow('draft')), false));
check(() => assert.equal(canSendFlow(flowRow('BLOCKED')), false));
check(() => assert.match(describeFlowStatus(flowRow('THROTTLED')), /some customers and not others/));
check(() => assert.match(describeFlowStatus(flowRow('draft')), /not sent to Meta yet/));

console.log(`whatsapp flows: ${checks} assertions passed`);
