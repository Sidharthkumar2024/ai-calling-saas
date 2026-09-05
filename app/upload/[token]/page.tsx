import { CustomerUpload } from '@/components/customer-upload';

export const dynamic = 'force-dynamic';

/**
 * The page a customer lands on from the link in their WhatsApp message.
 *
 * Nothing is looked up here. The token is handed to the client component,
 * which asks the API what is being requested — so a link that has expired or
 * has already been used says so on the page the customer opened, rather than
 * after they have chosen a file.
 */
export default async function UploadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <CustomerUpload token={token} />;
}
