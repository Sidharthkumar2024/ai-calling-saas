import Link from 'next/link';
import { ServiceStatus } from '@/components/service-status';
export const metadata = {
  title: 'API & service status | Call Vani',
  description:
    'Call Vani platform status, voice providers, incidents and maintenance updates.',
};
export default function StatusPage() {
  return (
    <main className="min-h-screen bg-surface-muted px-4 py-8 text-ink sm:px-8">
      <nav className="mx-auto mb-10 flex max-w-5xl items-center justify-between">
        <Link href="/" className="text-xl font-semibold">
          Call Vani
        </Link>
        <Link href="/docs" className="text-sm text-ink-muted">
          API documentation
        </Link>
      </nav>
      <div className="mx-auto max-w-5xl">
        <ServiceStatus />
      </div>
    </main>
  );
}
