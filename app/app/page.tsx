import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { CustomerPortal } from '@/components/customer-portal';
import { getSessionFromHeaders, isCustomerRole } from '@/lib/app-auth';
import { getCustomerAccess } from '@/lib/customer-rbac';

export const dynamic = 'force-dynamic';

export default async function CustomerAppPage() {
  const session = await getSessionFromHeaders(await headers());
  if (!session || !isCustomerRole(session.role) || !session.organizationName) {
    redirect('/login');
  }
  const access = await getCustomerAccess(session);
  return (
    <CustomerPortal
      session={{
        name: session.name,
        email: session.email,
        organizationName: session.organizationName,
        workspaceRole: access.role,
        permissions: access.permissions,
      }}
    />
  );
}
