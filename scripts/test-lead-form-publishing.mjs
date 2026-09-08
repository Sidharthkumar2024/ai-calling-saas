import assert from 'node:assert/strict';

import {
  collectLeadFields,
  validateLeadFields,
} from '../lib/lead-form-fields.ts';
import {
  draftOf,
  publishDiff,
  publishState,
  publishedOf,
  sameShape,
} from '../lib/lead-form-publishing.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

const BASE = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'phone', label: 'Phone', type: 'tel', required: true },
];

const row = (over = {}) => ({
  status: 'draft',
  version: 1,
  fields_json: JSON.stringify(BASE),
  settings_json: JSON.stringify({ title: 'Call me' }),
  allowed_domains_json: JSON.stringify(['https://shop.example']),
  published_fields_json: null,
  published_settings_json: null,
  published_domains_json: null,
  published_version: null,
  ...over,
});

const publishedRow = (over = {}) =>
  row({
    status: 'active',
    published_fields_json: JSON.stringify(BASE),
    published_settings_json: JSON.stringify({ title: 'Call me' }),
    published_domains_json: JSON.stringify(['https://shop.example']),
    published_version: 1,
    ...over,
  });

// --- what is live -------------------------------------------------------------

// The whole point: no snapshot means nothing is live, not "the draft is live".
check(() => assert.equal(publishedOf(row()), null));
check(() => assert.equal(publishState(row()), 'draft'));
check(() => assert.deepEqual(publishedOf(publishedRow())?.fields, BASE));
check(() => assert.equal(publishState(publishedRow()), 'published'));
// A form taken down serves nobody, even though its snapshot is kept so it can
// go back up unchanged.
check(() =>
  assert.equal(publishedOf(publishedRow({ status: 'draft' })), null),
);
check(() =>
  assert.equal(publishState(publishedRow({ status: 'draft' })), 'unpublished'),
);
// Editing a live form no longer changes what visitors see.
check(() =>
  assert.equal(
    publishState(
      publishedRow({
        fields_json: JSON.stringify([
          ...BASE,
          { key: 'budget', label: 'Budget', type: 'number', required: false },
        ]),
      }),
    ),
    'unpublished_changes',
  ),
);
check(() =>
  assert.deepEqual(
    publishedOf(
      publishedRow({
        fields_json: JSON.stringify([
          ...BASE,
          { key: 'budget', label: 'Budget', type: 'number', required: false },
        ]),
      }),
    )?.fields,
    BASE,
  ),
);
// Broken JSON in a column must not be read as "no fields at all" for a live
// form the same way an empty draft would be.
check(() => assert.deepEqual(draftOf(row({ fields_json: '{oops' })).fields, []));

// --- comparing ----------------------------------------------------------------

const shape = (over = {}) => ({
  fields: BASE,
  settings: { title: 'Call me' },
  domains: ['https://a.example', 'https://b.example'],
  ...over,
});
check(() => assert.equal(sameShape(shape(), shape()), true));
// Key order out of a database is not a change a visitor could notice.
check(() =>
  assert.equal(
    sameShape(shape({ settings: { title: 'Call me', a: 1 } }), shape({ settings: { a: 1, title: 'Call me' } })),
    true,
  ),
);
check(() =>
  assert.equal(
    sameShape(shape(), shape({ domains: ['https://b.example', 'https://a.example'] })),
    true,
  ),
);
check(() =>
  assert.equal(sameShape(shape(), shape({ settings: { title: 'Different' } })), false),
);
check(() =>
  assert.equal(sameShape(shape(), shape({ domains: ['https://a.example'] })), false),
);

// --- what publishing would do -------------------------------------------------

check(() => assert.match(publishDiff(row())[0], /first time/));
check(() => assert.match(publishDiff(publishedRow())[0], /Nothing/));
check(() =>
  assert.ok(
    publishDiff(
      publishedRow({
        fields_json: JSON.stringify([
          ...BASE,
          { key: 'budget', label: 'Budget', type: 'number', required: false },
        ]),
      }),
    ).some((line) => /Adds the "Budget" field/.test(line)),
  ),
);
check(() =>
  assert.ok(
    publishDiff(
      publishedRow({ fields_json: JSON.stringify([BASE[0], BASE[1]].slice(0, 2)), published_fields_json: JSON.stringify([...BASE, { key: 'budget', label: 'Budget', type: 'number', required: false }]) }),
    ).some((line) => /Removes the "Budget" field/.test(line)),
  ),
);
// The change that silently breaks an existing embed gets its own sentence.
check(() =>
  assert.ok(
    publishDiff(
      publishedRow({ allowed_domains_json: JSON.stringify([]) }),
    ).some((line) => /Stops accepting leads from https:\/\/shop.example/.test(line)),
  ),
);
check(() =>
  assert.ok(
    publishDiff(
      publishedRow({
        allowed_domains_json: JSON.stringify([
          'https://shop.example',
          'https://new.example',
        ]),
      }),
    ).some((line) => /Allows https:\/\/new.example/.test(line)),
  ),
);
check(() =>
  assert.ok(
    publishDiff(
      publishedRow({
        fields_json: JSON.stringify([
          BASE[0],
          { ...BASE[1], label: 'Mobile' },
        ]),
      }),
    ).some((line) => /Renames "Phone" to "Mobile"/.test(line)),
  ),
);
check(() =>
  assert.ok(
    publishDiff(
      publishedRow({ settings_json: JSON.stringify({ title: 'New words' }) }),
    ).some((line) => /wording and appearance/.test(line)),
  ),
);

// --- the new field types ------------------------------------------------------

const withField = (field) => validateLeadFields([...BASE, field]);

check(() =>
  assert.equal(withField({ key: 'notesText', label: 'Details', type: 'textarea', required: false })[2].type, 'textarea'),
);
check(() =>
  assert.equal(withField({ key: 'visitOn', label: 'Visit on', type: 'date', required: false })[2].type, 'date'),
);
check(() =>
  assert.equal(withField({ key: 'consent', label: 'Agree', type: 'checkbox', required: false })[2].type, 'checkbox'),
);
check(() => assert.throws(() => withField({ key: 'x', label: 'X', type: 'file', required: false })));
// A dropdown with nothing to choose is a required field nobody can complete.
check(() => assert.throws(() => withField({ key: 'plan', label: 'Plan', type: 'select', required: true })));
check(() =>
  assert.throws(() =>
    withField({ key: 'plan', label: 'Plan', type: 'select', options: ['One'], required: true }),
  ),
);
check(() =>
  assert.deepEqual(
    withField({ key: 'plan', label: 'Plan', type: 'select', options: ['Basic', 'Basic', 'Pro'], required: true })[2].options,
    ['Basic', 'Pro'],
  ),
);
// Name and phone keep their meaning whatever the editor claims.
check(() =>
  assert.equal(
    validateLeadFields([BASE[0], { ...BASE[1], type: 'date' }])[1].type,
    'tel',
  ),
);

const selectFields = withField({
  key: 'plan',
  label: 'Plan',
  type: 'select',
  options: ['Basic', 'Pro'],
  required: true,
});
const answers = (over) =>
  collectLeadFields(selectFields, {
    name: 'Asha',
    phone: '+919876543210',
    plan: 'Pro',
    ...over,
  });
check(() => assert.equal(answers({}).plan, 'Pro'));
// The choices are the accepted answers; anything else was never offered.
check(() => assert.throws(() => answers({ plan: 'Enterprise' }), /offered options/));
check(() => assert.throws(() => answers({ plan: '' }), /required/));

const dateFields = withField({ key: 'visitOn', label: 'Visit on', type: 'date', required: false });
const dated = (value) =>
  collectLeadFields(dateFields, { name: 'A', phone: '+919876543210', visitOn: value });
check(() => assert.equal(dated('2026-03-14').visitOn, '2026-03-14'));
check(() => assert.equal(dated('').visitOn, ''));
check(() => assert.throws(() => dated('14/03/2026'), /date like/));
// "2026-02-31" is not a day, and Date would roll it into March without saying so.
check(() => assert.throws(() => dated('2026-02-31'), /date like/));

const tickFields = withField({ key: 'consent', label: 'Agree', type: 'checkbox', required: true });
const ticked = (value) =>
  collectLeadFields(tickFields, { name: 'A', phone: '+919876543210', consent: value });
check(() => assert.equal(ticked(true).consent, 'yes'));
check(() => assert.equal(ticked('on').consent, 'yes'));
check(() => assert.equal(ticked('yes').consent, 'yes'));
check(() => assert.throws(() => ticked(false), /required/));
check(() => assert.throws(() => ticked('maybe'), /ticked or left empty/));

const longFields = withField({ key: 'story', label: 'Story', type: 'textarea', required: false });
check(() =>
  assert.equal(
    collectLeadFields(longFields, { name: 'A', phone: '+919876543210', story: 'x'.repeat(4000) }).story.length,
    4000,
  ),
);
check(() =>
  assert.throws(() =>
    collectLeadFields(longFields, { name: 'A', phone: '+919876543210', story: 'x'.repeat(5001) }),
  ),
);

console.log(`lead-form publishing: ${checks} assertions passed`);
