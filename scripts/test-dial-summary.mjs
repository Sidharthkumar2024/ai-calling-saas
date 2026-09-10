import assert from 'node:assert/strict';

import {
  describeDialPass,
  dialPassNeedsAttention,
} from '../lib/dial-summary.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

const pass = (over = {}) => ({
  campaignId: 'camp_1',
  status: 'running',
  considered: 0,
  attempted: 0,
  skipped: {},
  requeued: false,
  ...over,
});

// --- the case this exists for -----------------------------------------------------

// Press Start with no phone number connected: the campaign turns "running" and
// nothing is dialled. The reason was computed and thrown away.
const notLive = pass({
  reason: 'onboarding_incomplete:phone_number_pending|kyc_not_submitted',
});
check(() => assert.match(describeDialPass(notLive), /cannot place live calls yet/));
check(() => assert.match(describeDialPass(notLive), /phone number pending, kyc not submitted/));
check(() => assert.equal(dialPassNeedsAttention(notLive), true));
// With no blockers named, the sentence still stands on its own.
check(() =>
  assert.match(
    describeDialPass(pass({ reason: 'onboarding_incomplete:' })),
    /cannot place live calls yet\. The campaign will start/,
  ),
);

// --- whole passes that could not start ---------------------------------------------

check(() =>
  assert.match(describeDialPass(pass({ reason: 'insufficient_credits', status: 'paused' })), /below 10 credits/),
);
check(() => assert.equal(dialPassNeedsAttention(pass({ reason: 'insufficient_credits' })), true));
check(() =>
  assert.match(describeDialPass(pass({ reason: 'outside_calling_window' })), /calling window/),
);
// Waiting for a window or a slot is the campaign working, not failing, so it
// must not be shown as a problem.
check(() => assert.equal(dialPassNeedsAttention(pass({ reason: 'outside_calling_window' })), false));
check(() => assert.equal(dialPassNeedsAttention(pass({ reason: 'concurrency_saturated' })), false));
check(() =>
  assert.match(describeDialPass(pass({ reason: 'concurrency_saturated' })), /call slot is already in use/),
);
check(() => assert.match(describeDialPass(pass({ reason: 'campaign_not_found' })), /no longer exists/));

// --- contact-level skips -------------------------------------------------------------

// The difference between these two is the difference between two completely
// different afternoons.
const allSuppressed = pass({ considered: 40, skipped: { suppressed: 40 } });
check(() => assert.match(describeDialPass(allSuppressed), /Nothing was dialled/));
check(() => assert.match(describeDialPass(allSuppressed), /40 contacts were skipped/));
check(() => assert.match(describeDialPass(allSuppressed), /do-not-contact list/));
check(() => assert.equal(dialPassNeedsAttention(allSuppressed), true));

const noConnection = pass({ considered: 12, skipped: { telephony_unconfigured: 12 } });
check(() => assert.match(describeDialPass(noConnection), /no calling connection is live/));

// Largest reason first, so the sentence leads with the thing worth fixing.
const mixed = pass({ considered: 30, skipped: { no_consent: 4, suppressed: 21 } });
check(() => assert.match(describeDialPass(mixed), /21 on the do-not-contact list, 4 without recorded consent/));

// An unrecognised reason is still reported rather than swallowed.
check(() =>
  assert.match(describeDialPass(pass({ considered: 2, skipped: { some_new_gate: 2 } })), /2 some new gate/),
);

// --- calls actually placed -------------------------------------------------------------

const dialling = pass({ considered: 10, attempted: 7, skipped: { no_consent: 3 } });
check(() => assert.match(describeDialPass(dialling), /^Calling 7 contacts\./));
check(() => assert.match(describeDialPass(dialling), /3 contacts were skipped/));
// Calls going out is not something to flag, whatever else was skipped.
check(() => assert.equal(dialPassNeedsAttention(dialling), false));
check(() => assert.equal(describeDialPass(pass({ attempted: 1, considered: 1 })), 'Calling 1 contact.'));

// --- nothing to do ----------------------------------------------------------------------

check(() =>
  assert.match(describeDialPass(pass({ considered: 0 })), /no contacts waiting to be called/),
);
check(() =>
  assert.match(describeDialPass(pass({ considered: 5 })), /Nothing was dialled on this pass/),
);
// A pass that was never reported at all must not invent one.
check(() => assert.equal(describeDialPass(null), 'Campaign started.'));
check(() => assert.equal(describeDialPass(undefined), 'Campaign started.'));
check(() => assert.equal(dialPassNeedsAttention(null), false));

// A pass that reached nobody because this build cannot place campaign calls
// says so. It used to report those same contacts as attempted.
const notWired = describeDialPass(
  pass({ considered: 12, skipped: { origination_not_wired: 12 }, requeued: true }),
);
check(() => assert.ok(!notWired.includes('12 dialled')));
check(() => assert.ok(notWired.includes('cannot place calls')));
check(() =>
  assert.equal(
    dialPassNeedsAttention(
      pass({ considered: 12, skipped: { origination_not_wired: 12 } }),
    ),
    true,
  ),
);

console.log(`dial summary: ${checks} assertions passed`);
