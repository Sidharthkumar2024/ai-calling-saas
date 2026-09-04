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

export type MfaRequirement =
  | 'not_required'
  | 'satisfied'
  | 'grace'
  | 'must_enrol';

/**
 * How long a privileged account has to enrol before it is shut out.
 *
 * Turning enforcement on retroactively locks out every existing privileged
 * account the moment it deploys, mid-work, with no warning — which is an
 * outage the product inflicts on itself, not a security improvement. Real
 * products give a window and say so. Enforcement still happens; it just does
 * not happen at midnight to people who were never told.
 *
 * The clock starts when the account is first seen needing it, not at signup:
 * an account created a year before this rule existed would otherwise have a
 * window that expired long ago, which is the same lockout wearing a date.
 */
export const MFA_GRACE_DAYS = 7;

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
  /** ISO timestamp when this account's window closes, if one was started. */
  graceUntil?: string | null;
  now?: number;
}): MfaRequirement {
  const privileged =
    input.role === 'platform_admin' ||
    PRIVILEGED_APP_ROLES.has(input.role) ||
    PRIVILEGED_WORKSPACE_ROLES.has(String(input.workspaceRole ?? ''));
  if (!privileged) return 'not_required';
  if (input.mfaEnabled) return 'satisfied';
  const until = Date.parse(String(input.graceUntil ?? ''));
  // No window recorded yet means this account has never been asked. It gets
  // one — the caller is responsible for persisting it.
  if (!Number.isFinite(until)) return 'grace';
  return (input.now ?? Date.now()) < until ? 'grace' : 'must_enrol';
}

/** When a window opened now would close. */
export function graceDeadline(now: number = Date.now()): string {
  return new Date(now + MFA_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** The warning shown while an account still has time. */
export function graceMessage(graceUntil: string | null | undefined): string {
  const until = Date.parse(String(graceUntil ?? ''));
  const days = Number.isFinite(until)
    ? Math.max(0, Math.ceil((until - Date.now()) / (24 * 60 * 60 * 1000)))
    : MFA_GRACE_DAYS;
  return `Your role requires two-factor authentication. You have ${days} day${days === 1 ? '' : 's'} to set it up in Settings › Security before access is restricted.`;
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
