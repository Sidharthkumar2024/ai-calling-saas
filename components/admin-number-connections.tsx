'use client';
import { PhoneCall, ArrowUpRight, PlugZap, ShieldCheck } from 'lucide-react';
import { ProviderLogo } from '@/components/provider-logo';
import { numberConnectionLabel } from '@/lib/number-connection';
import { Button } from '@/components/ui/button';

export function AdminNumberConnections({
  numbers,
  onNavigate,
}: {
  numbers: Record<string, unknown>[];
  onNavigate: (page: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-ink-muted">
            Customer-owned telephony
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Numbers & connections</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-muted">
            Customers connect numbers from their own carrier accounts. Manage
            connection readiness and call routing here. Number purchase, rental
            and identity verification stay with the carrier.
          </p>
        </div>
        <Button variant="outline" onClick={() => onNavigate('integrations')}>
          <PlugZap /> View integrations
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          [
            PhoneCall,
            'Connected number slots',
            String(numbers.length),
            'Existing numbers added by customers',
          ],
          [
            PlugZap,
            'Active routes',
            String(numbers.filter((n) => n.status === 'active').length),
            'Routes currently enabled for calling',
          ],
          [
            ShieldCheck,
            'Provider-managed verification',
            'BYO carrier',
            'Call Vani does not approve number KYC',
          ],
        ].map(([Icon, title, value, note]) => {
          const I = Icon as typeof PhoneCall;
          return (
            <section
              key={String(title)}
              className="rounded-2xl border border-hairline bg-surface p-5"
            >
              <I className="size-5 text-primary" />
              <p className="mt-4 text-xs text-ink-muted">{String(title)}</p>
              <p className="mt-2 text-2xl font-semibold">{String(value)}</p>
              <p className="mt-2 text-xs text-ink-muted">{String(note)}</p>
            </section>
          );
        })}
      </div>
      <section className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        <div className="border-b border-hairline p-5">
          <h2 className="font-semibold">Customer connections</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Provider setup and routing are separate from carrier ownership
            verification.
          </p>
        </div>
        {!numbers.length ? (
          <p className="p-8 text-sm text-ink-muted">
            No customer numbers connected yet.
          </p>
        ) : (
          <div className="divide-y divide-hairline">
            {numbers.map((n) => (
              <div
                key={String(n.id)}
                className="grid gap-4 p-5 sm:grid-cols-[1fr_1fr_1fr]"
              >
                <div className="flex items-center gap-3">
                  <ProviderLogo provider={String(n.provider_code)} />
                  <div>
                    <p className="font-medium">{String(n.phone_number)}</p>
                    <p className="text-xs text-ink-muted">
                      {String(
                        n.organization_name ??
                          n.customer_name ??
                          'Customer account',
                      )}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-sm capitalize">
                    {String(n.provider_code ?? 'Provider')} ·{' '}
                    {String(n.direction ?? '').replaceAll('_', ' ')}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {String(
                      n.assigned_agent_name || 'Agent routing not assigned',
                    )}
                  </p>
                </div>
                <span className="self-center justify-self-start rounded-full border border-hairline px-3 py-1.5 text-xs">
                  {numberConnectionLabel(String(n.status))}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      <Button variant="outline" onClick={() => onNavigate('plans_billing')}>
        Manage connection limits in plans <ArrowUpRight />
      </Button>
    </div>
  );
}
