import assert from 'node:assert/strict';

import {
  DEFAULT_TTL_HOURS,
  MAX_ATTEMPTS,
  MAX_TTL_HOURS,
  describeRequest,
  expiryFrom,
  isDocumentRequestStatus,
  linkBase,
  linkProblem,
  normaliseDocumentLabel,
  requestMessage,
  requestState,
  uploadPath,
  uploadUrl,
} from '../lib/document-requests.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

// --- labels -----------------------------------------------------------------

check(() =>
  assert.equal(normaliseDocumentLabel('  PAN   card \n'), 'PAN card'),
);
// An unresolved template is the exact thing that must never reach a customer,
// so it is stripped rather than passed through.
check(() =>
  assert.equal(normaliseDocumentLabel('{{doc_type}} proof'), 'proof'),
);
check(() => assert.equal(normaliseDocumentLabel(null), ''));
check(() => assert.equal(normaliseDocumentLabel('x'.repeat(200)).length, 80));

// --- the base URL -----------------------------------------------------------

check(() =>
  assert.equal(
    linkBase('https://vaani.example.com/'),
    'https://vaani.example.com',
  ),
);
check(() =>
  assert.equal(linkBase('http://localhost:3002'), 'http://localhost:3002'),
);
// A path in the env var must not survive into the link.
check(() =>
  assert.equal(
    linkBase('https://vaani.example.com/app/'),
    'https://vaani.example.com',
  ),
);
check(() => assert.equal(linkBase('vaani.example.com'), null));
check(() => assert.equal(linkBase('ftp://vaani.example.com'), null));
check(() => assert.equal(linkBase(''), null));
check(() => assert.equal(linkBase(undefined), null));

check(() => assert.equal(linkProblem('https://vaani.example.com'), null));
check(() => assert.match(linkProblem(''), /no PUBLIC_BASE_URL/));
check(() => assert.match(linkProblem('vaani.example.com'), /not an absolute/));

// --- the link ---------------------------------------------------------------

check(() => assert.equal(uploadPath('abc123'), '/upload/abc123'));
check(() =>
  assert.equal(
    uploadUrl('https://vaani.example.com', 'abc123'),
    'https://vaani.example.com/upload/abc123',
  ),
);
// No origin means no link — never a relative path that resolves to whatever
// host the customer's phone happens to guess.
check(() => assert.equal(uploadUrl('', 'abc123'), null));
check(() => assert.equal(uploadUrl('https://vaani.example.com', ''), null));

// --- expiry -----------------------------------------------------------------

const noon = new Date('2026-09-05T12:00:00.000Z');
check(() => assert.equal(expiryFrom(noon, 24), '2026-09-06T12:00:00.000Z'));
check(() =>
  assert.equal(
    expiryFrom(noon),
    new Date(noon.getTime() + DEFAULT_TTL_HOURS * 3_600_000).toISOString(),
  ),
);
check(() =>
  assert.equal(
    expiryFrom(noon, 10_000),
    new Date(noon.getTime() + MAX_TTL_HOURS * 3_600_000).toISOString(),
  ),
);
check(() =>
  assert.equal(
    expiryFrom(noon, 0),
    new Date(noon.getTime() + 3_600_000).toISOString(),
  ),
);

// --- state ------------------------------------------------------------------

const open = {
  status: 'open',
  expires_at: '2026-09-08T12:00:00.000Z',
  attempts: 0,
};

check(() => assert.equal(requestState(open, noon).open, true));
check(() => assert.equal(requestState(null, noon).open, false));

// A row can still read 'open' long after its deadline — nothing sweeps the
// table — so the timestamp decides, not the column.
check(() =>
  assert.equal(
    requestState(open, new Date('2026-09-09T00:00:00.000Z')).reason,
    'expired',
  ),
);
check(() =>
  assert.equal(
    requestState({ ...open, status: 'fulfilled' }, noon).reason,
    'fulfilled',
  ),
);
check(() =>
  assert.equal(
    requestState({ ...open, status: 'cancelled' }, noon).reason,
    'cancelled',
  ),
);
check(() =>
  assert.equal(
    requestState({ ...open, attempts: MAX_ATTEMPTS }, noon).reason,
    'too_many_attempts',
  ),
);
check(() =>
  assert.equal(
    requestState({ ...open, attempts: MAX_ATTEMPTS - 1 }, noon).open,
    true,
  ),
);
// An already-fulfilled request stays closed even if the attempt counter is
// also over: the customer should be told the file arrived, not that they were
// locked out.
check(() =>
  assert.equal(
    requestState({ status: 'fulfilled', expires_at: null, attempts: 99 }, noon)
      .reason,
    'fulfilled',
  ),
);
check(() =>
  assert.equal(
    requestState({ status: 'weird', expires_at: null, attempts: 0 }, noon)
      .reason,
    'unknown_status',
  ),
);
// No deadline recorded is not the same as expired.
check(() =>
  assert.equal(
    requestState({ status: 'open', expires_at: null, attempts: 0 }, noon).open,
    true,
  ),
);

check(() => assert.equal(isDocumentRequestStatus('open'), true));
check(() => assert.equal(isDocumentRequestStatus('sent'), false));

// --- the message ------------------------------------------------------------

const message = requestMessage({
  document: 'PAN card',
  url: 'https://vaani.example.com/upload/abc123',
  business: 'Sunrise Homes',
  expiresAt: '2026-09-08T12:00:00.000Z',
  now: noon,
});
check(() => assert.match(message, /Sunrise Homes needs your PAN card\./));
// The whole point: the link the sentence refers to is in the sentence.
check(() =>
  assert.ok(message.includes('https://vaani.example.com/upload/abc123')),
);
check(() => assert.match(message, /next 3 days/));
check(() => assert.ok(!message.includes('{{')));

check(() =>
  assert.match(
    requestMessage({ document: '', url: 'https://x.test/upload/t' }),
    /We need your the document\.|We need your document/,
  ),
);
check(() =>
  assert.match(
    requestMessage({
      document: 'Aadhaar',
      url: 'https://x.test/upload/t',
      expiresAt: '2026-09-06T00:00:00.000Z',
      now: noon,
    }),
    /next 12 hours/,
  ),
);
// Under an hour reads as "shortly" rather than "0 hours".
check(() =>
  assert.match(
    requestMessage({
      document: 'Aadhaar',
      url: 'https://x.test/upload/t',
      expiresAt: '2026-09-05T12:30:00.000Z',
      now: noon,
    }),
    /expires shortly/,
  ),
);
// No deadline, no sentence about one.
check(() =>
  assert.ok(
    !requestMessage({
      document: 'Aadhaar',
      url: 'https://x.test/upload/t',
    }).includes('expire'),
  ),
);

// --- the workspace's line ---------------------------------------------------

check(() =>
  assert.match(
    describeRequest({
      document: 'PAN card',
      status: 'open',
      expiresAt: open.expires_at,
      now: noon,
    }),
    /waiting for the customer/,
  ),
);
check(() =>
  assert.match(
    describeRequest({ document: 'PAN card', status: 'fulfilled' }),
    /received/,
  ),
);
check(() =>
  assert.match(
    describeRequest({
      document: 'PAN card',
      status: 'open',
      expiresAt: '2026-09-01T00:00:00.000Z',
      now: noon,
    }),
    /link expired/,
  ),
);

console.log(`document-requests: ${checks} assertions passed`);
