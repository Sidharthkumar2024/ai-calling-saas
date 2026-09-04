/**
 * Who must have a second factor (Blueprint §14).
 *
 * §14: "2FA — Super Admin + customer; enforce for privileged roles." Enrolment
 * has existed since the security screen was written — `mfa_begin`,
 * `mfa_confirm`, a TOTP secret, and a login that demands a code from anybody
 * who enrolled. What was missing is the word *enforce*: nobody had to. A
 * platform administrator holding every capability in the product could work
 * with a password alone, and the feature was there to reassure rather than to
 * protect.
 *
 * The hard part is enforcing it without locking anybody out. Refusing to log in
 * an unenrolled admin is not enforcement, it is a door with no key: enrolling
 * requires being logged in. So a privileged account with no second factor gets
 * a session that can do exactly one thing — set one up.
 *
 * Pure: the policy and the allow-list, so what is reachable while restricted is
 * one readable list rather than a condition repeated at every route.
 */

export type MfaRequirement = 'not_required' | 'satisfied' | 'must_enrol';

/**
 * Customer roles that hold enough to warrant a second factor.
 *
 * An owner can move money and change who has access; a finance approver
 * releases refunds. A support agent or analyst cannot, and requiring a
 * authenticator app of every telecaller on a shift would be enforcement
 * theatre paid for by the people least able to absorb it.
 */
const PRIVILEGED_APP_ROLES = new Set(['customer_owner']);

/**
 * Workspace roles that hold everything (`lib/customer-rbac.ts`).
 *
 * `owner` and `admin` both carry every permission in the product, including
 * billing and team management, so both need a second factor whatever the
 * account's app role happens to be. A sales manager, agent, support agent or
 * analyst does not: requiring an authenticator app of every telecaller on a
 * shift is enforcement theatre paid for by the people least able to absorb it,
 * and none of them can move money or change who has access.
 */
const PRIVILEGED_WORKSPACE_ROLES = new Set(['owner', 'admin']);

/**
 * Decides what one account needs.
 *
 * Every platform admin counts, whatever their sub-role: even `analyst` reads
 * across every tenant in the product, which is exactly the access worth
 * stealing.
 */
export function mfaRequirement(input: {
  role: string;
  workspaceRole?: string | null;
  mfaEnabled: boolean;
}): MfaRequirement {
  const privileged =
    input.role === 'platform_admin' ||
    PRIVILEGED_APP_ROLES.has(input.role) ||
    PRIVILEGED_WORKSPACE_ROLES.has(String(input.workspaceRole ?? ''));
  if (!privileged) return 'not_required';
  return input.mfaEnabled ? 'satisfied' : 'must_enrol';
}

/**
 * What a restricted session may still reach.
 *
 * Deliberately tiny, and deliberately not a prefix match on `/api/auth`: that
 * would leave `team-invite` and `providers` open, and a restricted admin must
 * not be able to invite themselves a second account instead of enrolling.
 *
 * Reading the session is allowed so the portal can render at all and tell the
 * person why they are stuck.
 */
const RESTRICTED_ALLOW_LIST = [
  '/api/auth/security',
  '/api/auth/session',
  '/api/auth/logout',
];

export function allowedWhileRestricted(pathname: string): boolean {
  const path = String(pathname ?? '')
    .split('?')[0]
    .replace(/\/+$/, '');
  return RESTRICTED_ALLOW_LIST.includes(path);
}

/**
 * The refusal a restricted session gets.
 *
 * Says what to do, not just that it failed: a 403 reading "forbidden" on every
 * screen at once looks like a broken deployment, and the person cannot guess
 * that the fix is on the security page.
 */
export function restrictionMessage(role: string): string {
  const who =
    role === 'platform_admin' ? 'Platform administrators' : 'Your role';
  return `${who} must have two-factor authentication enabled. Open Settings › Security and set up an authenticator app to continue.`;
}
