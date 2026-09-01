import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { CustomerPortal } from '@/components/customer-portal';
import { getSessionFromHeaders, isCustomerRole } from '@/lib/app-auth';

export const dynamic = 'force-dynamic';

export default async function CustomerAppPage() {
  const session = await getSessionFromHeaders(await headers());
  if (!session || !isCustomerRole(session.role) || !session.organizationName) {
    redirect('/login');
  }
  return (
    <CustomerPortal
      session={{
        name: session.name,
        email: session.email,
        organizationName: session.organizationName,
      }}
    />
  );
}
