import assert from 'node:assert/strict';

import {
  describeTrunkStatus,
  isTrunkStatus,
  normaliseTrunkStatus,
  SUPPORTED_CODECS,
  TRUNK_STATUSES,
  trunkReadiness,
} from '../lib/sip-trunks.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

const good = {
  status: 'provider_test_pending',
  transport: 'tls',
  media_encryption: 'sdes',
  auth_type: 'userpass',
  encrypted_credentials: 'enc:xxx',
  codecs_json: '["PCMU","PCMA"]',
};

check(() => assert.equal(TRUNK_STATUSES.length, 3));
check(() => assert.equal(isTrunkStatus('provider_test_pending'), true));
check(() => assert.equal(isTrunkStatus('active'), false));
// There is no active state, and an unrecognised one is never treated as
// further along than it is.
check(() => assert.equal(normaliseTrunkStatus('active'), 'security_review_required'));
check(() => assert.equal(normaliseTrunkStatus(null), 'security_review_required'));

const ready = trunkReadiness(good);
check(() => assert.equal(ready.configured, true));
check(() => assert.deepEqual(ready.blockers, []));
// THE POINT: a fully configured trunk still cannot carry a call, and says so
// rather than reading as finished.
check(() => assert.equal(ready.carriesCalls, false));
check(() => assert.match(ready.summary, /cannot carry calls yet/));
check(() => assert.equal(ready.waitingOn.length, 2));
check(() => assert.match(ready.waitingOn[0], /does not register against a SIP gateway/));

// What is outside the customer's control is named every time, not only when
// something of theirs is wrong.
const broken = trunkReadiness({ ...good, transport: 'udp' });
check(() => assert.equal(broken.waitingOn.length, 2));

check(() =>
  assert.match(
    trunkReadiness({ ...good, transport: 'udp' }).blockers[0],
    /must be TLS/,
  ),
);
check(() =>
  assert.match(
    trunkReadiness({ ...good, media_encryption: 'none' }).blockers[0],
    /SRTP/,
  ),
);
check(() =>
  assert.match(
    trunkReadiness({ ...good, encrypted_credentials: null }).blockers[0],
    /username and password are missing/,
  ),
);
check(() =>
  assert.match(
    trunkReadiness({ ...good, codecs_json: '[]' }).blockers[0],
    /one supported codec/,
  ),
);
// An unreadable codec column is not a pass.
check(() =>
  assert.equal(trunkReadiness({ ...good, codecs_json: 'nonsense' }).configured, false),
);
// A codec nobody supports does not count as one.
check(() =>
  assert.equal(trunkReadiness({ ...good, codecs_json: '["G729"]' }).configured, false),
);
check(() => assert.equal(SUPPORTED_CODECS.length, 4));

// IP auth needs no stored credentials.
check(() =>
  assert.equal(
    trunkReadiness({
      ...good,
      auth_type: 'ip',
      encrypted_credentials: null,
    }).configured,
    true,
  ),
);

// Saved but never checked is a blocker the customer can clear themselves.
const unchecked = trunkReadiness({ ...good, status: 'configuration_saved' });
check(() => assert.equal(unchecked.configured, false));
check(() => assert.match(unchecked.blockers[0], /Run the configuration check/));

check(() =>
  assert.match(describeTrunkStatus('provider_test_pending'), /waiting on a SIP media plane/),
);
check(() => assert.match(describeTrunkStatus('configuration_saved'), /not checked yet/));
check(() => assert.match(describeTrunkStatus('anything'), /Needs TLS and SRTP/));

console.log(`sip-trunks: ${checks} assertions passed`);
