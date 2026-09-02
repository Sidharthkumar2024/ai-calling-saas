import { CustomerSignup } from '@/components/customer-signup';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const params = await searchParams;
  return <CustomerSignup inviteToken={params.invite} />;
}
