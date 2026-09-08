import assert from 'node:assert/strict';

import {
  bodyFromMeta,
  canSend,
  canSubmit,
  describeStatus,
  fillTemplate,
  placeholders,
  toMetaPayload,
  validateDraft,
  validateParams,
} from '../lib/whatsapp-templates.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

const draft = (over = {}) => ({
  name: 'appointment_reminder',
  language: 'en',
  category: 'UTILITY',
  header: null,
  body: 'Hello {{1}}, your visit is booked for {{2}}. See you then.',
  footer: null,
  ...over,
});

const template = (over = {}) => ({
  id: 'wt_1',
  ...draft(),
  status: 'APPROVED',
  provider_id: '123',
  rejected_reason: null,
  ...over,
});

// --- placeholders -------------------------------------------------------------

check(() => assert.deepEqual(placeholders('no variables here'), []));
check(() => assert.deepEqual(placeholders('Hi {{1}} and {{2}}'), [1, 2]));
// Meta numbers them; the same slot twice is one variable, not two.
check(() => assert.deepEqual(placeholders('{{1}} then {{1}} again'), [1]));
check(() => assert.deepEqual(placeholders('{{ 2 }} and {{1}}'), [1, 2]));
check(() => assert.deepEqual(placeholders('{{0}} is not a slot'), []));

// --- filling ------------------------------------------------------------------

check(() =>
  assert.equal(
    fillTemplate('Hello {{1}}, on {{2}}.', ['Asha', 'Tuesday']),
    'Hello Asha, on Tuesday.',
  ),
);
// A missing value stays visible rather than vanishing: a sentence with a hole
// in it should be noticed in the preview, not by the customer.
check(() =>
  assert.equal(fillTemplate('Hello {{1}}, on {{2}}.', ['Asha']), 'Hello Asha, on {{2}}.'),
);
check(() =>
  assert.equal(fillTemplate('Hello {{1}}.', ['']), 'Hello {{1}}.'),
);
check(() =>
  assert.equal(fillTemplate('{{1}} {{1}}', ['twice']), 'twice twice'),
);

// --- what Meta accepts --------------------------------------------------------

check(() => assert.deepEqual(validateDraft(draft()), []));
check(() =>
  assert.ok(
    validateDraft(draft({ name: 'Appointment Reminder' })).some((p) =>
      /lowercase/.test(p),
    ),
  ),
);
check(() =>
  assert.ok(validateDraft(draft({ name: 'has-dash' })).some((p) => /lowercase/.test(p))),
);
check(() =>
  assert.ok(validateDraft(draft({ language: 'english' })).some((p) => /language/.test(p))),
);
check(() => assert.deepEqual(validateDraft(draft({ language: 'en_US' })), []));
check(() =>
  assert.ok(validateDraft(draft({ category: 'PROMO' })).some((p) => /Marketing/.test(p))),
);
check(() =>
  assert.ok(validateDraft(draft({ body: '   ' })).some((p) => /cannot be empty/.test(p))),
);
check(() =>
  assert.ok(
    validateDraft(draft({ body: `x {{1}} ${'y'.repeat(1100)}` })).some((p) =>
      /1024 characters/.test(p),
    ),
  ),
);
check(() =>
  assert.ok(
    validateDraft(draft({ header: 'h'.repeat(61) })).some((p) => /header/.test(p)),
  ),
);
check(() =>
  assert.ok(
    validateDraft(draft({ footer: 'f'.repeat(61) })).some((p) => /footer/.test(p)),
  ),
);
// A gap in the numbering is a rejection two hours from now, so it is a
// rejection right now instead.
check(() =>
  assert.ok(
    validateDraft(draft({ body: 'Hi {{1}} and also {{3}} here.' })).some((p) =>
      /no gaps/.test(p),
    ),
  ),
);
check(() =>
  assert.ok(
    validateDraft(draft({ body: 'Hi {{2}} only.' })).some((p) => /no gaps/.test(p)),
  ),
);
check(() =>
  assert.ok(
    validateDraft(draft({ body: '{{1}} is at the start.' })).some((p) =>
      /begin or end/.test(p),
    ),
  ),
);
check(() =>
  assert.ok(
    validateDraft(draft({ body: 'It ends on {{1}}' })).some((p) =>
      /begin or end/.test(p),
    ),
  ),
);
check(() =>
  assert.ok(
    validateDraft(draft({ body: 'Hi {{1}}{{2}} there.' })).some((p) =>
      /between two variables/.test(p),
    ),
  ),
);
// Every reason at once, not the first one found.
check(() =>
  assert.ok(validateDraft({ name: 'BAD', language: 'x', category: 'NOPE', body: '' }).length >= 4),
);

// --- what the workspace may do ------------------------------------------------

check(() => assert.equal(canSend(template()), true));
check(() => assert.equal(canSend(template({ status: 'PENDING' })), false));
check(() => assert.equal(canSend(template({ status: 'PAUSED' })), false));
check(() => assert.equal(canSubmit(template({ status: 'draft' })), true));
check(() => assert.equal(canSubmit(template({ status: 'REJECTED' })), true));
check(() => assert.equal(canSubmit(template({ status: 'APPROVED' })), false));
check(() => assert.equal(canSubmit(template({ status: 'PENDING' })), false));
// Meta's own words survive to the screen.
check(() =>
  assert.match(
    describeStatus(template({ status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' })),
    /INVALID_FORMAT/,
  ),
);
check(() => assert.match(describeStatus(template({ status: 'draft' })), /not sent to Meta/));
check(() => assert.match(describeStatus(template()), /24-hour window/));

// --- parameters for one send --------------------------------------------------

check(() => assert.deepEqual(validateParams('Hi {{1}} on {{2}}.', ['A', 'B']), []));
check(() =>
  assert.ok(validateParams('Hi {{1}} on {{2}}.', ['A']).some((p) => /\{\{2\}\}/.test(p))),
);
check(() =>
  assert.ok(validateParams('Hi {{1}}.', ['  ']).some((p) => /Fill in/.test(p))),
);
check(() =>
  assert.ok(
    validateParams('Hi {{1}}.', ['two\nlines']).some((p) => /line breaks/.test(p)),
  ),
);
check(() =>
  assert.ok(
    validateParams('Hi {{1}}.', ['wide     gap']).some((p) => /line breaks/.test(p)),
  ),
);
check(() => assert.deepEqual(validateParams('No variables.', []), []));

// --- the Meta payload ---------------------------------------------------------

check(() => {
  const payload = toMetaPayload(draft(), ['Asha', 'Tuesday']);
  assert.equal(payload.name, 'appointment_reminder');
  assert.equal(payload.components.length, 1);
  assert.deepEqual(payload.components[0].example, {
    body_text: [['Asha', 'Tuesday']],
  });
});
// A body with variables and no examples is rejected outright, so one is always
// supplied rather than left out.
check(() => {
  const payload = toMetaPayload(draft(), []);
  assert.deepEqual(payload.components[0].example, {
    body_text: [['sample 1', 'sample 2']],
  });
});
check(() => {
  const payload = toMetaPayload(draft({ body: 'No variables at all.' }));
  assert.equal(payload.components[0].example, undefined);
});
check(() => {
  const payload = toMetaPayload(draft({ header: 'Your visit', footer: 'Call Vani' }));
  assert.deepEqual(
    payload.components.map((c) => c.type),
    ['HEADER', 'BODY', 'FOOTER'],
  );
});

check(() =>
  assert.equal(
    bodyFromMeta([
      { type: 'HEADER', text: 'h' },
      { type: 'BODY', text: 'the body' },
    ]),
    'the body',
  ),
);
check(() => assert.equal(bodyFromMeta(null), ''));
check(() => assert.equal(bodyFromMeta([{ type: 'BODY' }]), ''));

console.log(`whatsapp-templates: ${checks} assertions passed`);
