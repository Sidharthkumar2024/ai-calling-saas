import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import type { AppSession } from '@/lib/app-auth';

export const CUSTOMER_PERMISSIONS = [
  'workspace.manage',
  'team.manage',
  'agents.manage',
  'campaigns.manage',
  'crm.manage',
  'telephony.manage',
  'integrations.manage',
  'billing.manage',
  'analytics.view',
  'analytics.manage',
  'calls.monitor',
  'support.manage',
] as const;

export type CustomerPermission = (typeof CUSTOMER_PERMISSIONS)[number];
export type CustomerWorkspaceRole =
  | 'owner'
  | 'admin'
  | 'sales_manager'
  | 'agent'
  | 'support_agent'
  | 'analyst'
  | 'billing';

const allPermissions = [...CUSTOMER_PERMISSIONS];

export const CUSTOMER_ROLE_DEFINITIONS: Array<{
  id: CustomerWorkspaceRole;
  label: string;
  description: string;
  permissions: CustomerPermission[];
}> = [
  {
    id: 'owner',
    label: 'Owner',
    description: 'Full workspace, billing, security and team control.',
    permissions: allPermissions,
  },
  {
    id: 'admin',
    label: 'Workspace admin',
    description: 'Runs the workspace, integrations, telephony and team.',
    permissions: allPermissions,
  },
  {
    id: 'sales_manager',
    label: 'Sales manager',
    description: 'Agents, CRM, campaigns, call monitoring and analytics.',
    permissions: [
      'agents.manage',
      'campaigns.manage',
      'crm.manage',
      'analytics.view',
      'analytics.manage',
      'calls.monitor',
    ],
  },
  {
    id: 'agent',
    label: 'Sales agent',
    description: 'Works assigned leads and customer conversations.',
    permissions: ['crm.manage', 'calls.monitor'],
  },
  {
    id: 'support_agent',
    label: 'Support agent',
    description: 'Handles support records, tickets and escalations.',
    permissions: ['crm.manage', 'calls.monitor', 'support.manage'],
  },
  {
    id: 'analyst',
    label: 'Analyst',
    description: 'Read-only analytics, reports and call quality views.',
    permissions: ['analytics.view'],
  },
  {
    id: 'billing',
    label: 'Billing manager',
    description: 'Plans, credits, invoices and payment administration.',
    permissions: ['billing.manage'],
  },
];

export type ResolvedWorkspaceRole = CustomerWorkspaceRole | 'none';

export async function getCustomerAccess(session: AppSession): Promise<{
  role: ResolvedWorkspaceRole;
  permissions: CustomerPermission[];
}> {
  if (session.role === 'customer_owner') {
    return { role: 'owner', permissions: allPermissions };
  }
  const member = session.organizationId
    ? await getRawDb()
        .prepare(`SELECT role FROM organization_members
          WHERE organization_id = ? AND user_id = ? LIMIT 1`)
        .bind(session.organizationId, session.userId)
        .first<{ role: string }>()
    : null;
  const definition = CUSTOMER_ROLE_DEFINITIONS.find(
    (item) => item.id === member?.role,
  );
  // Fail closed: an absent membership row or an unrecognised role grants
  // nothing. Previously this fell back to 'agent', silently handing CRM and
  // call-monitor access to anyone whose role string did not match.
  if (!definition) return { role: 'none', permissions: [] };
  return { role: definition.id, permissions: definition.permissions };
}

/**
 * Who may change whose role. An admin must not be able to demote or remove
 * another admin or the owner — only the owner can act on an admin.
 */
export function canManageTargetRole(
  actorRole: ResolvedWorkspaceRole,
  targetRole: string,
): boolean {
  if (actorRole === 'owner') return targetRole !== 'owner';
  if (actorRole === 'admin')
    return !['owner', 'admin'].includes(targetRole);
  return false;
}

export async function requireCustomerPermission(
  request: Request,
  permission: CustomerPermission,
) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth;
  const access = await getCustomerAccess(auth.session);
  if (!access.permissions.includes(permission)) {
    return {
      response: NextResponse.json(
        { error: `Workspace permission required: ${permission}.` },
        { status: 403 },
      ),
    } as const;
  }
  return { session: auth.session, access } as const;
}

/**
 * Read guard for endpoints that serve several modules at once: the caller must
 * hold at least one of the listed permissions. Using a single permission there
 * would lock out legitimate roles (an analyst reading reports, for example),
 * while using none at all is what left these GETs open to any org member.
 */
export async function requireAnyCustomerPermission(
  request: Request,
  permissions: CustomerPermission[],
) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth;
  const access = await getCustomerAccess(auth.session);
  if (!permissions.some((permission) => access.permissions.includes(permission))) {
    return {
      response: NextResponse.json(
        { error: `Workspace permission required: one of ${permissions.join(', ')}.` },
        { status: 403 },
      ),
    } as const;
  }
  return { session: auth.session, access } as const;
}

export function publicRoleCatalog() {
  return CUSTOMER_ROLE_DEFINITIONS.map((role) => ({
    id: role.id,
    label: role.label,
    description: role.description,
    permissions: role.permissions,
  }));
}
