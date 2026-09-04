import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireAdmin } from '@/lib/api-session';

/**
 * Platform admin sub-roles (blueprint §21).
 *
 * `requireAdmin` was a single `role === 'platform_admin'` boolean, so every
 * admin could do everything — including irreversible tenant actions. These
 * sub-roles keep that surface deliberate.
 */
export const ADMIN_CAPABILITIES = [
  'tenants.read',
  'tenants.manage',
  'tenants.suspend',
  'providers.manage',
  'billing.manage',
  'support.access',
  'security.manage',
] as const;

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number];
export type AdminRole = 'super_admin' | 'operations' | 'finance' | 'analyst';

const ROLE_CAPABILITIES: Record<AdminRole, AdminCapability[]> = {
  super_admin: [...ADMIN_CAPABILITIES],
  operations: [
    'tenants.read',
    'tenants.manage',
    'providers.manage',
    'support.access',
  ],
  finance: ['tenants.read', 'billing.manage'],
  analyst: ['tenants.read'],
};

export function adminCapabilities(role: string): AdminCapability[] {
  // Unknown roles fail closed to read-only rather than inheriting everything.
  return ROLE_CAPABILITIES[role as AdminRole] ?? ['tenants.read'];
}

/**
 * Resolves the signed-in admin's sub-role.
 *
 * This used to answer `super_admin` for a null column *or a failed query*,
 * which made the sub-roles decorative: an operations admin whose column had
 * never been set held every capability, and a transient database error handed
 * out the full platform. The reason given was not locking the original operator
 * out of a database that predates the column — a real concern, but a migration
 * problem, not an authorisation one. `ensureSchema` now backfills existing
 * platform admins to `super_admin` once, so this can fail closed to the
 * read-only role the way `getCustomerAccess` already does.
 */
export async function adminRole(userId: string): Promise<AdminRole> {
  try {
    const row = await getRawDb()
      .prepare(`SELECT admin_role FROM app_users WHERE id = ? LIMIT 1`)
      .bind(userId)
      .first<{ admin_role: string | null }>();
    const value = row?.admin_role;
    if (value && value in ROLE_CAPABILITIES) return value as AdminRole;
    return 'analyst';
  } catch {
    // An error is not permission. Read-only is the safe answer.
    return 'analyst';
  }
}

export async function requireAdminCapability(
  request: Request,
  capability: AdminCapability,
) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth;
  const role = await adminRole(auth.session.userId);
  if (!adminCapabilities(role).includes(capability)) {
    return {
      response: NextResponse.json(
        {
          error: `This action needs the ${capability} capability; your admin role is ${role}.`,
        },
        { status: 403 },
      ),
    };
  }
  return { ...auth, adminRole: role };
}
