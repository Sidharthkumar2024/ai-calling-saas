import assert from 'node:assert/strict';

import {
  MFA_GRACE_DAYS,
  allowedWhileRestricted,
  graceDeadline,
  graceMessage,
  mfaRequirement,
  restrictionMessage,
} from '../lib/mfa-policy.ts';

const past = new Date(Date.now() - 1000).toISOString();
const future = new Date(Date.now() + 86_400_000).toISOString();

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log('mfaRequirement');

check('a platform admin without a second factor is restricted', () => {
  // Someone holding every capability in the product could work with a password
  // alone: enrolment existed and nothing required it.
  assert.equal(
    mfaRequirement({
      role: 'platform_admin',
      mfaEnabled: false,
      graceUntil: past,
    }),
    'must_enrol',
  );
});

check('every admin sub-role counts, analyst included', () => {
  // An analyst reads across every tenant, which is exactly the access worth
  // stealing.
  for (const workspaceRole of [null, 'analyst', 'owner'])
    assert.equal(
      mfaRequirement({
        role: 'platform_admin',
        workspaceRole,
        mfaEnabled: false,
        graceUntil: past,
      }),
      'must_enrol',
      String(workspaceRole),
    );
});

check('a workspace owner is privileged', () => {
  assert.equal(
    mfaRequirement({
      role: 'customer_owner',
      mfaEnabled: false,
      graceUntil: past,
    }),
    'must_enrol',
  );
});

check('a workspace admin is privileged whatever their app role', () => {
  // `owner` and `admin` both carry every permission in customer-rbac, so an
  // app-role check alone would miss this person entirely.
  assert.equal(
    mfaRequirement({
      role: 'customer_agent',
      workspaceRole: 'admin',
      mfaEnabled: false,
      graceUntil: past,
    }),
    'must_enrol',
  );
});

check('an agent, analyst or support member is not forced', () => {
  // Requiring an authenticator app of every telecaller on a shift is
  // enforcement theatre paid for by the people least able to absorb it, and
  // none of them can move money or change who has access.
  for (const workspaceRole of [
    'agent',
    'support_agent',
    'analyst',
    'sales_manager',
  ])
    assert.equal(
      mfaRequirement({
        role: 'customer_agent',
        workspaceRole,
        mfaEnabled: false,
      }),
      'not_required',
      workspaceRole,
    );
});

check('enrolling satisfies it', () => {
  assert.equal(
    mfaRequirement({ role: 'platform_admin', mfaEnabled: true }),
    'satisfied',
  );
  assert.equal(
    mfaRequirement({
      role: 'customer_agent',
      workspaceRole: 'owner',
      mfaEnabled: true,
    }),
    'satisfied',
  );
});

check('an unprivileged account that enrolled anyway is not restricted', () => {
  assert.equal(
    mfaRequirement({ role: 'customer_agent', mfaEnabled: true }),
    'not_required',
  );
});

check('an unknown role is not silently privileged', () => {
  assert.equal(mfaRequirement({ role: '', mfaEnabled: false }), 'not_required');
  assert.equal(
    mfaRequirement({ role: 'something_new', mfaEnabled: false }),
    'not_required',
  );
});

console.log('the grace window');

check('an account never asked before gets a window, not a wall', () => {
  // Switching enforcement on retroactively locks out every privileged account
  // mid-work with no warning — an outage the product inflicts on itself, not a
  // security improvement.
  assert.equal(
    mfaRequirement({ role: 'platform_admin', mfaEnabled: false }),
    'grace',
  );
  assert.equal(
    mfaRequirement({
      role: 'platform_admin',
      mfaEnabled: false,
      graceUntil: null,
    }),
    'grace',
  );
});

check('an unexpired window still lets them work', () => {
  assert.equal(
    mfaRequirement({
      role: 'customer_owner',
      mfaEnabled: false,
      graceUntil: future,
    }),
    'grace',
  );
});

check('an expired window restricts', () => {
  assert.equal(
    mfaRequirement({
      role: 'customer_owner',
      mfaEnabled: false,
      graceUntil: past,
    }),
    'must_enrol',
  );
});

check('enrolling ends it early whatever the window says', () => {
  assert.equal(
    mfaRequirement({
      role: 'platform_admin',
      mfaEnabled: true,
      graceUntil: past,
    }),
    'satisfied',
  );
});

check('an unprivileged role never enters the window at all', () => {
  assert.equal(
    mfaRequirement({
      role: 'customer_agent',
      workspaceRole: 'agent',
      mfaEnabled: false,
      graceUntil: null,
    }),
    'not_required',
  );
});

check('a corrupt deadline is treated as never asked, not as expired', () => {
  // The safe direction: a bad value must not lock somebody out.
  for (const bad of ['', 'soon', '0000-13-45'])
    assert.equal(
      mfaRequirement({
        role: 'platform_admin',
        mfaEnabled: false,
        graceUntil: bad,
      }),
      'grace',
      bad,
    );
});

check('the deadline is the configured number of days out', () => {
  const now = Date.parse('2026-09-04T00:00:00.000Z');
  const deadline = Date.parse(graceDeadline(now));
  assert.equal((deadline - now) / 86_400_000, MFA_GRACE_DAYS);
});

check('the warning counts down in days', () => {
  assert.match(graceMessage(future), /1 day\b/);
  assert.match(graceMessage(future), /Settings/);
});

console.log('allowedWhileRestricted');

check('enrolling stays reachable', () => {
  // Refusing everything would be a door with no key: enrolling requires being
  // signed in.
  assert.equal(allowedWhileRestricted('/api/auth/security'), true);
  assert.equal(allowedWhileRestricted('/api/auth/session'), true);
  assert.equal(allowedWhileRestricted('/api/auth/logout'), true);
});

check('a trailing slash or query string does not open a hole', () => {
  assert.equal(allowedWhileRestricted('/api/auth/security/'), true);
  assert.equal(allowedWhileRestricted('/api/auth/security?x=1'), true);
});

check('the rest of the product is closed', () => {
  for (const path of [
    '/api/app/crm',
    '/api/app/billing/checkout',
    '/api/admin/platform',
    '/api/app/calls/control',
  ])
    assert.equal(allowedWhileRestricted(path), false, path);
});

check('the allow-list is not a prefix match on /api/auth', () => {
  // A prefix would leave team-invite open, and a restricted admin must not be
  // able to invite themselves a second account instead of enrolling.
  assert.equal(allowedWhileRestricted('/api/auth/team-invite'), false);
  assert.equal(allowedWhileRestricted('/api/auth/providers'), false);
  assert.equal(allowedWhileRestricted('/api/auth/signup'), false);
});

check('a path that merely starts with an allowed one is closed', () => {
  assert.equal(allowedWhileRestricted('/api/auth/security-bypass'), false);
  assert.equal(allowedWhileRestricted('/api/auth/sessionx'), false);
});

check('rubbish input is closed, not opened', () => {
  assert.equal(allowedWhileRestricted(''), false);
  assert.equal(allowedWhileRestricted(null), false);
  assert.equal(allowedWhileRestricted(undefined), false);
});

console.log('restrictionMessage');

check('the refusal says what to do about it', () => {
  // A generic "forbidden" on every screen at once looks like a broken
  // deployment, and nobody guesses the fix is on the security page.
  const message = restrictionMessage('platform_admin');
  assert.match(message, /Platform administrators/);
  assert.match(message, /Security/);
  assert.match(message, /authenticator/);
  assert.match(restrictionMessage('customer_owner'), /Your role/);
});

console.log(`\n${passed} assertions passed.`);
