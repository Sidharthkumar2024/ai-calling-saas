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

export async function getCustomerAccess(session: AppSession) {
  if (session.role === 'customer_owner') {
    return {
      role: 'owner' as CustomerWorkspaceRole,
      permissions: allPermissions,
    };
  }
  const member = session.organizationId
    ? await getRawDb()
        .prepare(`SELECT role FROM organization_members
          WHERE organization_id = ? AND user_id = ? LIMIT 1`)
        .bind(session.organizationId, session.userId)
        .first<{ role: string }>()
    : null;
  const requestedRole = CUSTOMER_ROLE_DEFINITIONS.find(
    (item) => item.id === member?.role,
  );
  const role = requestedRole?.id ?? 'agent';
  return {
    role,
    permissions:
      CUSTOMER_ROLE_DEFINITIONS.find((item) => item.id === role)?.permissions ??
      [],
  };
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

export function publicRoleCatalog() {
  return CUSTOMER_ROLE_DEFINITIONS.map((role) => ({
    id: role.id,
    label: role.label,
    description: role.description,
    permissions: role.permissions,
  }));
}
