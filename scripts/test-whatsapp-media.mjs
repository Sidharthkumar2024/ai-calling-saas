import assert from 'node:assert/strict';

import {
  ALLOWED_INCOMING,
  buildSendSet,
  canMove,
  checkIncomingMedia,
  DEFAULT_SEND_POLICY,
  describeSend,
  DOCUMENT_STATUSES,
  isDocumentStatus,
  MAX_BYTES,
  nextStatuses,
  VALIDATION_NOTE,
  assetsOfRecord,
  describeSendRow,
  isSendStatus,
  parseEntries,
  recordIdOfAsset,
  SEND_STATUSES,
  statusAfterRelease,
  withheldLabel,
} from '../lib/whatsapp-media.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);

console.log('incoming media — what may be stored');

check('an allowed type of a sane size is accepted', () => {
  const result = checkIncomingMedia({
    mimeType: 'image/jpeg',
    sizeBytes: 200_000,
    bytes: jpeg,
  });
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'image');
  assert.equal(result.extension, 'jpg');
});

check('a type nobody allowed is refused by name', () => {
  const result = checkIncomingMedia({
    mimeType: 'application/x-msdownload',
    sizeBytes: 1000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'type_not_allowed');
  assert.match(result.detail, /application\/x-msdownload/);
});

check('a mime type with a charset suffix still matches', () => {
  assert.equal(
    checkIncomingMedia({
      mimeType: 'application/pdf; charset=binary',
      sizeBytes: 500,
      bytes: pdf,
    }).ok,
    true,
  );
});

check('an executable renamed as a JPEG is caught by its bytes', () => {
  // The check that earns its keep: the provider's mime type is a claim by
  // whoever sent the file. Everything else passes for this one.
  const result = checkIncomingMedia({
    mimeType: 'image/jpeg',
    sizeBytes: 4000,
    bytes: exe,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'content_mismatch');
  assert.match(result.detail, /not stored/i);
});

check('a PNG announced as a PDF is caught too', () => {
  assert.equal(
    checkIncomingMedia({
      mimeType: 'application/pdf',
      sizeBytes: 4000,
      bytes: png,
    }).reason,
    'content_mismatch',
  );
});

check('the right bytes for the declared type pass', () => {
  assert.equal(
    checkIncomingMedia({ mimeType: 'image/png', sizeBytes: 900, bytes: png })
      .ok,
    true,
  );
  assert.equal(
    checkIncomingMedia({
      mimeType: 'application/pdf',
      sizeBytes: 900,
      bytes: pdf,
    }).ok,
    true,
  );
});

check('mp4 is matched at its offset, not at byte zero', () => {
  const mp4 = new Uint8Array([
    0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  ]);
  assert.equal(
    checkIncomingMedia({ mimeType: 'video/mp4', sizeBytes: 5000, bytes: mp4 })
      .ok,
    true,
  );
});

check('a truncated file does not pass by being too short to disprove', () => {
  assert.equal(
    checkIncomingMedia({
      mimeType: 'image/png',
      sizeBytes: 3,
      bytes: new Uint8Array([0x89]),
    }).reason,
    'content_mismatch',
  );
});

console.log('\nsize is refused before the file is fetched');

check('over the per-kind cap is refused with both numbers', () => {
  const result = checkIncomingMedia({
    mimeType: 'image/jpeg',
    sizeBytes: MAX_BYTES.image + 1,
  });
  assert.equal(result.reason, 'too_large');
  assert.match(result.detail, /limit for a image/);
});

check('a document may be larger than an image', () => {
  assert.ok(MAX_BYTES.document > MAX_BYTES.image);
  assert.equal(
    checkIncomingMedia({
      mimeType: 'application/pdf',
      sizeBytes: MAX_BYTES.image + 1,
      bytes: pdf,
    }).ok,
    true,
  );
});

check('an unstated size is refused rather than fetched to find out', () => {
  // Refusing a 200MB file after downloading it defeats the point of a limit.
  assert.equal(
    checkIncomingMedia({ mimeType: 'image/jpeg', sizeBytes: 0 }).reason,
    'unknown_size',
  );
  assert.equal(
    checkIncomingMedia({ mimeType: 'image/jpeg', sizeBytes: NaN }).reason,
    'unknown_size',
  );
});

check(
  'checks run before bytes are available, so the size check works alone',
  () => {
    assert.equal(
      checkIncomingMedia({ mimeType: 'image/jpeg', sizeBytes: 1000 }).ok,
      true,
    );
  },
);

console.log('\nand it does not claim to be an antivirus');

check('the note says plainly what was and was not done', () => {
  // "malware validation" is one word this cannot deliver, so it says so.
  assert.match(VALIDATION_NOTE, /Not scanned for viruses/i);
  assert.match(VALIDATION_NOTE, /type, contents and size/i);
});

check('the allowlist has no archives or executables in it', () => {
  for (const mime of Object.keys(ALLOWED_INCOMING))
    assert.doesNotMatch(
      mime,
      /zip|rar|7z|msdownload|octet-stream|javascript|html/,
    );
});

console.log('\ndocument states');

check('every status is a known status', () => {
  for (const status of DOCUMENT_STATUSES)
    assert.equal(isDocumentStatus(status), true);
  assert.equal(isDocumentStatus('approved'), false);
});

check('a new document can go anywhere a reviewer needs', () => {
  assert.deepEqual(nextStatuses('new'), [
    'under_review',
    'accepted',
    'rejected',
    'needs_new_file',
  ]);
});

check('accepted is terminal', () => {
  // A decision has been made on it — a KYC passed, a payment matched — and
  // flipping it back later leaves that decision standing on a file the screen
  // no longer vouches for.
  assert.deepEqual(nextStatuses('accepted'), []);
  assert.equal(canMove('accepted', 'rejected'), false);
});

check('a rejected document comes back only through review', () => {
  assert.deepEqual(nextStatuses('rejected'), ['under_review']);
  assert.equal(canMove('rejected', 'accepted'), false);
  assert.equal(canMove('rejected', 'under_review'), true);
});

console.log('\noutbound — an agent sends from an approved set');

const asset = (id, kind = 'image', extra = {}) => ({
  id,
  kind,
  label: `${id}.${kind}`,
  url: `https://x.test/${id}`,
  ...extra,
});

check('an ordinary request goes out whole', () => {
  const set = buildSendSet({ requested: [asset('a'), asset('b')] });
  assert.equal(set.sending.length, 2);
  assert.deepEqual(set.withheld, []);
  assert.equal(set.needsApproval, false);
});

check('a sensitive file is held for a person, not quietly included', () => {
  const set = buildSendSet({
    requested: [asset('a'), asset('secret', 'document', { sensitive: true })],
  });
  assert.equal(set.sending.length, 1);
  assert.equal(set.needsApproval, true);
  assert.match(set.withheld[0].reason, /Marked sensitive/);
});

check('a kind this agent may not send is held back', () => {
  const set = buildSendSet({
    requested: [asset('clip', 'video')],
    policy: { ...DEFAULT_SEND_POLICY, allowedKinds: ['image'] },
  });
  assert.equal(set.sending.length, 0);
  assert.match(set.withheld[0].reason, /not allowed to send video/);
});

check(
  'beyond the per-message limit is held back, not truncated silently',
  () => {
    const set = buildSendSet({
      requested: [asset('a'), asset('b'), asset('c')],
      policy: { ...DEFAULT_SEND_POLICY, maxAssets: 2 },
    });
    assert.equal(set.sending.length, 2);
    assert.equal(set.withheld.length, 1);
    assert.match(set.withheld[0].reason, /2-file limit/);
  },
);

check('a policy that permits sensitive files sends them', () => {
  const set = buildSendSet({
    requested: [asset('secret', 'document', { sensitive: true })],
    policy: { ...DEFAULT_SEND_POLICY, allowSensitive: true },
  });
  assert.equal(set.sending.length, 1);
  assert.equal(set.needsApproval, false);
});

console.log('\nand tells the caller the truth about it');

check('a complete send says what went', () => {
  const set = buildSendSet({ requested: [asset('plan')] });
  assert.match(describeSend(set), /Sent 1 file: plan\.image\./);
});

check('a partial send tells the agent NOT to claim it all arrived', () => {
  // "I have sent all of them" when two were held back is the failure this
  // exists to prevent, and the caller is who notices.
  const set = buildSendSet({
    requested: [asset('a'), asset('s', 'document', { sensitive: true })],
  });
  const line = describeSend(set);
  assert.match(line, /1 more was not sent/);
  assert.match(line, /do not claim they were already delivered/);
});

check('nothing sent says so rather than staying silent', () => {
  const set = buildSendSet({
    requested: [asset('clip', 'video')],
    policy: { ...DEFAULT_SEND_POLICY, allowedKinds: ['image'] },
  });
  assert.match(describeSend(set), /Nothing could be sent/);
});

console.log('\nreleasing what an agent was refused');

check('every send status is a known one', () => {
  assert.equal(SEND_STATUSES.length, 5);
  assert.equal(isSendStatus('partially_released'), true);
  assert.equal(isSendStatus('sent'), false);
});

check('an unreadable column reads as empty rather than throwing', () => {
  assert.deepEqual(parseEntries('not json'), []);
  assert.deepEqual(parseEntries(null), []);
  // A JSON object is not a list of entries either.
  assert.deepEqual(parseEntries('{"id":"a"}'), []);
  assert.deepEqual(parseEntries('[{"id":"a"}]'), [{ id: 'a' }]);
});

check('an asset id says which record it came from', () => {
  assert.equal(recordIdOfAsset('rec_9f2:brochure:0'), 'rec_9f2');
  assert.equal(recordIdOfAsset('nocolon'), null);
  assert.equal(recordIdOfAsset(''), null);
});

check('a send with anything still waiting is not finished', () => {
  // Somebody on a call was told a colleague would send the rest. A row that
  // still holds one file must not read as done.
  assert.equal(
    statusAfterRelease({ remainingWithheld: 1, totalSent: 3 }),
    'partially_released',
  );
  assert.equal(
    statusAfterRelease({ remainingWithheld: 0, totalSent: 3 }),
    'released',
  );
  assert.equal(
    statusAfterRelease({ remainingWithheld: 0, totalSent: 0 }),
    'nothing_to_send',
  );
});

check('the queue line names what is still owed to whom', () => {
  const line = describeSendRow({
    destination: '9810012345',
    sent: [{ id: 'a', label: 'A' }],
    withheld: [
      { id: 'b', reason: 'Marked sensitive — a person has to release it.' },
    ],
    status: 'queued',
  });
  assert.match(line, /1 file is still waiting for a person to release it/);
  assert.match(line, /9810012345/);
});

check('and says plainly when nothing is owed', () => {
  assert.match(
    describeSendRow({
      destination: '98100',
      sent: [{ id: 'a', label: 'A' }],
      withheld: [],
      status: 'released',
    }),
    /All 1 sent/,
  );
  assert.match(
    describeSendRow({
      destination: '98100',
      sent: [],
      withheld: [],
      status: 'nothing_to_send',
    }),
    /Nothing was sendable/,
  );
  assert.match(
    describeSendRow({
      destination: '98100',
      sent: [],
      withheld: [{ id: 'b', reason: 'x' }],
      status: 'cancelled',
    }),
    /Withdrawn/,
  );
});

check('a release resolves the same assets the agent was refused', () => {
  // The ids have to match exactly, or a person would be releasing something
  // other than what was held back.
  const values = JSON.stringify({
    photo: 'https://cdn.test/a.jpg',
    private_floor_plan: 'https://cdn.test/b.pdf',
  });
  const assets = assetsOfRecord('rec_9f2', 'Skyline 3BHK', values);
  assert.equal(assets.length, 2);
  const set = buildSendSet({ requested: assets });
  assert.equal(set.withheld.length, 1);
  const held = set.withheld[0].asset;
  assert.equal(held.sensitive, true);
  assert.equal(recordIdOfAsset(held.id), 'rec_9f2');
  // Re-resolving the record produces the identical id, which is what makes
  // releasing from the record rather than from a stored URL possible.
  const again = assetsOfRecord('rec_9f2', 'Skyline 3BHK', values);
  assert.ok(again.some((asset) => asset.id === held.id));
});

check('a non-https url is not an asset at all', () => {
  const assets = assetsOfRecord(
    'rec_1',
    'X',
    JSON.stringify({
      photo: 'http://cdn.test/a.jpg',
      doc: 'javascript:alert(1)',
    }),
  );
  assert.deepEqual(assets, []);
});

check('a held-back file is named, not shown as an asset id', () => {
  assert.equal(
    withheldLabel({
      id: 'rec_1:brochure:0',
      label: 'Skyline 3BHK — brochure',
      reason: 'x',
    }),
    'Skyline 3BHK — brochure',
  );
  // Rows written before labels were kept still have to read as something a
  // person can decide about.
  assert.equal(
    withheldLabel({ id: 'rec_1:private_floor_plan:1', reason: 'x' }),
    'private floor plan',
  );
  assert.equal(withheldLabel({ id: 'odd', reason: 'x' }), 'odd');
});

console.log(`\n${passed} assertions passed.`);
