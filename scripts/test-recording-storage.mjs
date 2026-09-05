import assert from 'node:assert/strict';

import {
  keyBelongsTo,
  recordingKey,
  recordingPrefix,
} from '../lib/recording-keys.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log('the key is built here, not handed in');

check('it follows the tenant/calls/year/month/call convention', () => {
  const key = recordingKey({
    organizationId: 'org_abc',
    callId: 'call_123',
    at: new Date('2026-09-05T10:00:00Z'),
  });
  assert.equal(key, 'tenant/org_abc/calls/2026/09/call_123/recording.wav');
});

check('the month is zero-padded and the date is UTC', () => {
  // A lifecycle rule expiring "2026/01" must not be dodged by a local
  // timezone rolling the date over.
  const key = recordingKey({
    organizationId: 'o',
    callId: 'c',
    at: new Date('2026-01-01T00:30:00Z'),
  });
  assert.match(key, /\/2026\/01\//);
});

check('an extension is accepted but bounded', () => {
  assert.match(recordingKey({ organizationId: 'o', callId: 'c', extension: 'mp3' }), /\.mp3$/);
  assert.match(recordingKey({ organizationId: 'o', callId: 'c', extension: 'wav/../x' }), /\.wav$/);
  assert.match(recordingKey({ organizationId: 'o', callId: 'c', extension: '' }), /\.wav$/);
});

check('a traversal id is refused, not escaped', () => {
  // "../" in an object key is not a formatting problem to tidy up; it is a
  // caller doing something it should not.
  assert.throws(() => recordingKey({ organizationId: '../other', callId: 'c' }));
  assert.throws(() => recordingKey({ organizationId: 'o', callId: '../../etc' }));
  assert.throws(() => recordingKey({ organizationId: 'o', callId: 'a/b' }));
  assert.throws(() => recordingKey({ organizationId: '', callId: 'c' }));
});

check('an id that is simply too long is refused', () => {
  assert.throws(() => recordingKey({ organizationId: 'o'.repeat(200), callId: 'c' }));
});

console.log('\nand reading is refused unless the key is that tenant’s');

check('a key inside the tenant prefix is readable', () => {
  const key = recordingKey({ organizationId: 'org_abc', callId: 'c1' });
  assert.equal(keyBelongsTo(key, 'org_abc'), true);
});

check('another tenant’s key is not', () => {
  // The whole point: one bad write must not become one tenant serving
  // another tenant's audio.
  const key = recordingKey({ organizationId: 'org_abc', callId: 'c1' });
  assert.equal(keyBelongsTo(key, 'org_other'), false);
});

check('a prefix that merely starts the same is not a match', () => {
  const key = recordingKey({ organizationId: 'org_abcdef', callId: 'c1' });
  assert.equal(keyBelongsTo(key, 'org_abc'), false);
});

check('keys written before this convention still belong to their tenant', () => {
  // `<organization>/<call>.wav` is what the old code wrote. It is still that
  // workspace's own audio, so it stays readable — by them and nobody else.
  assert.equal(keyBelongsTo('org_abc/call_1.wav', 'org_abc'), true);
  assert.equal(keyBelongsTo('org_abc/call_1.wav', 'org_other'), false);
});

check('a traversal in a stored key is refused even if it starts right', () => {
  assert.equal(keyBelongsTo('tenant/org_abc/../org_other/x.wav', 'org_abc'), false);
});

check('an absent key reads as not belonging to anybody', () => {
  assert.equal(keyBelongsTo(null, 'org_abc'), false);
  assert.equal(keyBelongsTo('', 'org_abc'), false);
});

check('the prefix is the tenant boundary', () => {
  assert.equal(recordingPrefix('org_abc'), 'tenant/org_abc/');
});

console.log(`\n${passed} assertions passed.`);
