import assert from 'node:assert/strict';

import {
  ALWAYS_REQUIRED,
  canMoveKyc,
  describeKycStatus,
  isKycDocumentType,
  isKycStatus,
  KYC_DOCUMENT_LABEL,
  KYC_DOCUMENT_TYPES,
  KYC_STATUSES,
  kycProgress,
  nextKycStatuses,
  normaliseKycStatus,
  requiredFor,
} from '../lib/kyc-documents.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

// --- the vocabulary ----------------------------------------------------------

check(() => assert.equal(KYC_DOCUMENT_TYPES.length, 5));
check(() => assert.equal(isKycDocumentType('address_proof'), true));
check(() => assert.equal(isKycDocumentType('passport'), false));
check(() =>
  assert.deepEqual(
    KYC_DOCUMENT_TYPES.filter((type) => !KYC_DOCUMENT_LABEL[type]),
    [],
  ),
);

check(() => assert.equal(KYC_STATUSES.length, 4));
check(() => assert.equal(isKycStatus('under_review'), true));
check(() => assert.equal(isKycStatus('pending'), false));
// Anything unrecognised waits; it is never treated as cleared.
check(() => assert.equal(normaliseKycStatus('pending'), 'submitted'));
check(() => assert.equal(normaliseKycStatus(null), 'submitted'));
check(() => assert.equal(normaliseKycStatus('approved'), 'approved'));

// --- what a number needs -----------------------------------------------------

check(() => assert.equal(ALWAYS_REQUIRED.length, 4));
// Ownership proof only when the workspace brings a number it already holds —
// there is nothing to prove ownership of on one the provider is issuing.
check(() =>
  assert.equal(requiredFor('native_import').includes('telecom_ownership'), true),
);
check(() =>
  assert.equal(requiredFor('sip_trunk').includes('telecom_ownership'), true),
);
check(() =>
  assert.equal(
    requiredFor('managed_number').includes('telecom_ownership'),
    false,
  ),
);
check(() => assert.equal(requiredFor(null).length, 4));

// --- review moves ------------------------------------------------------------

check(() =>
  assert.deepEqual(nextKycStatuses('submitted'), [
    'under_review',
    'approved',
    'rejected',
  ]),
);
check(() =>
  assert.deepEqual(nextKycStatuses('under_review'), ['approved', 'rejected']),
);
// Approved is terminal: a document that turns out to be wrong is replaced by a
// new upload, so the trail still shows what was accepted and when.
check(() => assert.deepEqual(nextKycStatuses('approved'), []));
check(() => assert.deepEqual(nextKycStatuses('rejected'), []));
check(() => assert.equal(canMoveKyc('submitted', 'approved'), true));
check(() => assert.equal(canMoveKyc('approved', 'rejected'), false));

// --- what the customer reads -------------------------------------------------

check(() => assert.equal(describeKycStatus('approved'), 'Accepted.'));
check(() =>
  assert.match(describeKycStatus('submitted'), /waiting to be checked/),
);
check(() => assert.match(describeKycStatus('under_review'), /being checked/i));
// A rejection without a reason still tells them what to do next.
check(() =>
  assert.match(describeKycStatus('rejected'), /Upload a replacement/),
);
check(() =>
  assert.match(
    describeKycStatus('rejected', 'the GST number is not readable'),
    /not readable/,
  ),
);

// --- progress ----------------------------------------------------------------

const nothing = kycProgress([], 'managed_number');
check(() => assert.equal(nothing.complete, false));
check(() => assert.equal(nothing.missing.length, 4));
check(() => assert.match(nothing.message, /0 of 4 accepted/));
check(() => assert.match(nothing.message, /4 still to upload/));

const done = kycProgress(
  ALWAYS_REQUIRED.map((type) => ({ document_type: type, status: 'approved' })),
  'managed_number',
);
check(() => assert.equal(done.complete, true));
check(() => assert.equal(done.message, 'All required documents accepted.'));

// A rejected GST followed by a corrected one is not still rejected. Rows come
// newest-first, so the first of a type is the one that counts.
const corrected = kycProgress(
  [
    { document_type: 'business_registration', status: 'submitted' },
    { document_type: 'business_registration', status: 'rejected' },
  ],
  'managed_number',
);
check(() => assert.equal(corrected.rejected.length, 0));
check(() => assert.equal(corrected.waiting.length, 1));

// And the other way round: a later rejection overrides an earlier approval.
const regressed = kycProgress(
  [
    { document_type: 'address_proof', status: 'rejected' },
    { document_type: 'address_proof', status: 'approved' },
  ],
  'managed_number',
);
check(() => assert.equal(regressed.rejected.includes('address_proof'), true));
check(() => assert.equal(regressed.approved.includes('address_proof'), false));

// Rejections lead the message, because they are the only part a customer can
// act on today.
const mixed = kycProgress(
  [
    { document_type: 'business_registration', status: 'approved' },
    { document_type: 'authorized_signatory', status: 'rejected' },
    { document_type: 'address_proof', status: 'submitted' },
  ],
  'managed_number',
);
check(() => assert.match(mixed.message, /^1 of 4 accepted/));
check(() => assert.match(mixed.message, /1 to replace \(Authorised signatory ID\)/));
check(() => assert.match(mixed.message, /1 still to upload/));
check(() => assert.match(mixed.message, /1 waiting to be checked/));

// An extra document nobody asked for does not make the number complete.
const extras = kycProgress(
  [
    ...ALWAYS_REQUIRED.map((type) => ({ document_type: type, status: 'approved' })),
    { document_type: 'telecom_ownership', status: 'approved' },
  ],
  'native_import',
);
check(() => assert.equal(extras.complete, true));
const missingOwnership = kycProgress(
  ALWAYS_REQUIRED.map((type) => ({ document_type: type, status: 'approved' })),
  'native_import',
);
check(() => assert.equal(missingOwnership.complete, false));
check(() =>
  assert.deepEqual(missingOwnership.missing, ['telecom_ownership']),
);

console.log(`kyc-documents: ${checks} assertions passed`);
