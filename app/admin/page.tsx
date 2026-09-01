import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AdminPortal } from '@/components/admin-portal';
import { getSessionFromHeaders, isAdminRole } from '@/lib/app-auth';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await getSessionFromHeaders(await headers());
  if (!session || !isAdminRole(session.role)) redirect('/admin/login');
  return <AdminPortal session={{ name: session.name, email: session.email }} />;
}
