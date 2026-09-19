import { CreditCard, PhoneCall, Sparkles } from 'lucide-react';

export function BillingModelSummary({ admin = false }: { admin?: boolean }) {
  return (
    <section className="rounded-2xl border border-hairline bg-surface p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold">What your plan pays for</h2>
        <p className="mt-2 text-sm text-ink-muted">
          A clear split between Call Vani usage and the services connected to
          your account.
        </p>
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        {[
          {
            icon: CreditCard,
            title: 'Subscription & capacity',
            description:
              'AI agents, team access and connected-number limits. A number slot lets you connect a number you already own; it does not include number rental.',
          },
          {
            icon: Sparkles,
            title: 'Call Vani credits',
            description:
              'AI processing, platform call handling and supported automation actions use the rate card below. Your wallet ledger records actual deductions.',
          },
          {
            icon: PhoneCall,
            title: 'Your provider bill',
            description:
              'Your carrier bills its number rental and telecom usage directly. Connected SMS, email and Meta accounts may also have provider charges, separate from Call Vani credits.',
          },
        ].map((item) => (
          <div key={item.title} className="rounded-xl bg-surface-muted p-4">
            <item.icon className="size-5 text-primary" />
            <h3 className="mt-3 text-sm font-semibold">{item.title}</h3>
            <p className="mt-2 text-xs leading-5 text-ink-muted">
              {item.description}
            </p>
          </div>
        ))}
      </div>
      {admin && (
        <p className="mt-5 border-t border-hairline pt-4 text-xs leading-5 text-ink-muted">
          Margin reporting should include only costs Call Vani pays.
          Customer-paid carrier invoices are excluded. Configure platform
          provider costs before treating a margin estimate as verified profit.
        </p>
      )}
    </section>
  );
}
