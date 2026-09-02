import {
  Activity,
  ArrowRight,
  BookOpenText,
  Braces,
  CheckCircle2,
  CircleDollarSign,
  Globe2,
  KeyRound,
  LockKeyhole,
  PhoneCall,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';

const leadExample = `curl --request POST \\
  --url http://localhost:3000/api/v1/leads \\
  --header 'Authorization: Bearer vaani_live_YOUR_KEY' \\
  --header 'Content-Type: application/json' \\
  --data '{
    "sourceType": "meta_ads",
    "externalLeadId": "meta-12345",
    "name": "Aarav Khanna",
    "phone": "+919876544210",
    "email": "aarav@example.com",
    "campaignName": "Gurugram Luxury Homes",
    "productInterest": "3BHK property",
    "notes": "Wants pricing and a site visit this week."
  }'`;

const formExample = `<form id="vaani-lead-form">
  <input name="name" required />
  <input name="phone" required />
  <input name="email" type="email" />
  <button>Request a call</button>
</form>

<script>
document.querySelector('#vaani-lead-form')
  .addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    await fetch('http://localhost:3000/api/forms/form_urbannest/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  });
</script>`;

const verifyWebhookExample = `const signed = timestamp + '.' + rawRequestBody;
const expected = hmacSha256(signingSecret, signed);

// Header: X-Vaani-Signature: t=TIMESTAMP,v1=HEX_DIGEST
if (!timingSafeEqual(expected, signature.v1)) {
  throw new Error('Invalid webhook signature');
}`;

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-[#090b11] text-white">
      <header className="sticky top-0 z-40 border-b border-white/8 bg-[#090b11]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-amber-300 text-[#17120a]">
              <Activity className="size-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold">Vaani</span>
              <span className="block text-[9px] uppercase tracking-[0.18em] text-white/35">
                Developer docs
              </span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/admin/login"
              className="hidden rounded-lg px-3 py-2 text-xs text-white/45 hover:bg-white/5 hover:text-white sm:block"
            >
              Admin
            </Link>
            <Link
              href="/login"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-4 text-xs font-medium text-black hover:bg-white/90"
            >
              Open app <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1320px] lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] border-r border-white/8 px-4 py-8 lg:block">
          <p className="px-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/25">
            Get started
          </p>
          <nav className="mt-3 space-y-1 text-xs text-white/42">
            {[
              ['Overview', '#overview'],
              ['Authentication', '#authentication'],
              ['Lead API', '#lead-api'],
              ['Website forms', '#website-forms'],
              ['Trial playground', '#playground'],
              ['AI commerce', '#commerce'],
              ['Webhooks', '#webhooks'],
              ['Phone numbers', '#numbers'],
              ['Billing', '#billing'],
              ['Production backend', '#production-backend'],
              ['Willow connector', '#willow'],
              ['Architecture', '#architecture'],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="block rounded-lg px-3 py-2 hover:bg-white/5 hover:text-white"
              >
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <article className="min-w-0 px-4 py-12 sm:px-8 lg:px-12 lg:py-16">
          <section id="overview" className="scroll-mt-24">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/15 bg-amber-300/5 px-3 py-1.5 text-[10px] text-amber-200">
              <BookOpenText className="size-3.5" /> API v1 · Localhost
            </span>
            <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-6xl">
              Build lead-to-call workflows on Vaani.
            </h1>
            <p className="mt-6 max-w-3xl text-base leading-7 text-white/48">
              Capture leads, read wallet balance, receive signed call events and
              connect existing systems without exposing the voice and telephony
              providers behind Vaani.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <Info
                icon={Globe2}
                label="Base URL"
                value="http://localhost:3000/api/v1"
              />
              <Info
                icon={KeyRound}
                label="Authentication"
                value="Bearer API key"
              />
              <Info icon={Braces} label="Format" value="JSON · UTF-8" />
            </div>
          </section>

          <DocSection
            id="authentication"
            eyebrow="01 · Authentication"
            title="Scoped API keys, visible once"
          >
            <p>
              Open <strong>Customer app → Integrations & API → API keys</strong>
              . Create a separate key per server or website. Vaani returns the
              secret once, stores only its SHA-256 hash, and records last usage
              and revocation state.
            </p>
            <Code>{`Authorization: Bearer vaani_live_YOUR_KEY\nContent-Type: application/json`}</Code>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                'leads:write — capture lead records',
                'leads:read — list CRM leads',
                'credits:read — read wallet balance',
                'calls:write — reserved for call orchestration',
              ].map((scope) => (
                <div
                  key={scope}
                  className="flex items-center gap-2 rounded-xl border border-white/7 bg-white/[0.02] p-3 text-xs text-white/48"
                >
                  <CheckCircle2 className="size-3.5 text-emerald-300" /> {scope}
                </div>
              ))}
            </div>
          </DocSection>

          <DocSection
            id="lead-api"
            eyebrow="02 · Lead API"
            title="Capture, understand and queue the next action"
          >
            <Endpoint
              method="POST"
              path="/api/v1/leads"
              note="Requires leads:write"
            />
            <p>
              The response includes the normalized source, AI score, intent,
              summary, queued call job and opportunity reference. Repeating the
              same source + externalLeadId returns the existing lead instead of
              creating a duplicate.
            </p>
            <Code>{leadExample}</Code>
            <Endpoint
              method="GET"
              path="/api/v1/leads"
              note="Requires leads:read"
            />
            <p>
              Returns the latest 100 tenant-scoped leads in descending capture
              order.
            </p>
            <Endpoint
              method="GET"
              path="/api/v1/credits"
              note="Requires credits:read"
            />
            <p>
              Returns current balance, low-balance threshold and wallet update
              time.
            </p>
          </DocSection>

          <DocSection
            id="website-forms"
            eyebrow="03 · Website forms"
            title="Add Vaani to an existing popup or form"
          >
            <p>
              Website forms use a public form key rather than a private API key.
              Configure allowed domains in the customer workspace, then post the
              visible form fields to the endpoint.
            </p>
            <Code>{formExample}</Code>
            <div className="mt-5 rounded-xl border border-amber-300/12 bg-amber-300/[0.035] p-4 text-xs leading-5 text-white/52">
              <LockKeyhole className="mb-3 size-4 text-amber-200" />{' '}
              Allowed-origin validation, payload limits and per-IP/per-form rate
              limits run before ingestion. Add CAPTCHA/risk scoring at the edge
              for a public high-volume campaign.
            </div>
          </DocSection>

          <DocSection
            id="playground"
            eyebrow="04 · Trial playground"
            title="Test an agent without placing a phone call"
          >
            <p>
              Every new workspace receives <strong>100 trial credits</strong>{' '}
              and one draft agent. Text chat and browser voice each use 10
              credits per turn. Browser voice uses the browser microphone and
              speech output only after the user starts it; no telephony provider
              or phone number is involved.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Info
                icon={PhoneCall}
                label="Text chat"
                value="10 credits / turn"
              />
              <Info
                icon={PhoneCall}
                label="Browser voice"
                value="10 credits / turn"
              />
              <Info
                icon={LockKeyhole}
                label="Phone call"
                value="Number + KYC required"
              />
            </div>
            <Code>{`POST /api/app/agents/test
{
  "action": "start",
  "agentId": "agent_...",
  "mode": "browser_voice"
}`}</Code>
          </DocSection>

          <DocSection
            id="commerce"
            eyebrow="05 · AI commerce"
            title="Turn spoken intent into WhatsApp and Razorpay actions"
          >
            <p>
              The agent can prepare product details, create a fixed-amount
              Razorpay Payment Link, send it immediately using an approved
              WhatsApp template, or store a durable scheduled action such as
              “send it at 8 PM”. Tool results—not model claims—control CRM and
              payment status.
            </p>
            <Code>{`RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_PAYMENT_TEMPLATE=vaani_payment_link

POST /api/webhooks/razorpay`}</Code>
            <p>
              Without credentials, localhost creates an explicitly labelled
              sandbox link and message event. Razorpay webhooks require a public
              HTTPS endpoint; the local “Run due actions” control processes
              scheduled sandbox work without pretending that a provider
              delivered it.
            </p>
          </DocSection>

          <DocSection
            id="webhooks"
            eyebrow="06 · Webhooks"
            title="Receive signed revenue events"
          >
            <p>
              Create endpoints inside the customer app. Vaani supports{' '}
              <code>lead.created</code>, <code>lead.qualified</code>,{' '}
              <code>call.completed</code>, <code>appointment.booked</code> and{' '}
              <code>credit.low</code>. Production URLs must use HTTPS; HTTP
              localhost is allowed only for local testing.
            </p>
            <Code>{verifyWebhookExample}</Code>
            <p>
              Verify against the raw request body, reject timestamps outside a
              five-minute tolerance, and deduplicate using the event{' '}
              <code>id</code>. Failed deliveries enter the durable queue with
              exponential retry, attempt history and a dead-letter terminal
              state.
            </p>
          </DocSection>

          <DocSection
            id="numbers"
            eyebrow="07 · Phone numbers"
            title="Recommended hybrid number model"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <FlowCard
                icon={PhoneCall}
                title="Vaani-rented number"
                recommended
                points={[
                  'Customer requests city/use case',
                  'Business KYC and consent review',
                  'Dedicated number allocation',
                  'Assign agent and run two-way tests',
                  'Rental + usage deducted from wallet',
                ]}
              />
              <FlowCard
                icon={ShieldCheck}
                title="Bring your own carrier"
                points={[
                  'Verify existing number ownership',
                  'Connect call forwarding or SIP',
                  'Encrypt provider credentials',
                  'KYC and approved caller identity',
                  'Enterprise owns provider relationship',
                ]}
              />
            </div>
            <p>
              Statuses are explicit: <code>not_submitted</code> →{' '}
              <code>under_review</code> → <code>provider_review</code> →{' '}
              <code>approved</code> → <code>active</code>. Ownership
              verification alone does not activate outbound calling.
            </p>
          </DocSection>

          <DocSection
            id="billing"
            eyebrow="08 · SaaS billing"
            title="Plans, credits, invoices and payment webhooks"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Info
                icon={CircleDollarSign}
                label="Free"
                value="100 trial credits"
              />
              <Info
                icon={CircleDollarSign}
                label="Growth"
                value="₹7,999 / month"
              />
              <Info
                icon={CircleDollarSign}
                label="Scale"
                value="₹24,999 / month"
              />
            </div>
            <p>
              The customer chooses a plan or credit package. With Stripe
              configured, Vaani creates a hosted Checkout Session. Only the
              signed <code>checkout.session.completed</code> webhook changes the
              subscription or wallet. Event IDs are recorded for idempotency,
              credits are posted to the wallet and ledger, and a GST-ready
              invoice record is generated.
            </p>
            <Code>{`STRIPE_SECRET_KEY=...\nSTRIPE_WEBHOOK_SECRET=...\nNEXT_PUBLIC_BASE_URL=http://localhost:3000\n\nPOST /api/webhooks/stripe`}</Code>
            <p>
              Without Stripe keys, localhost uses a clearly labelled sandbox
              checkout. It never charges money but exercises the subscription,
              wallet, ledger and invoice lifecycle.
            </p>
          </DocSection>

          <DocSection
            id="production-backend"
            eyebrow="09 · Production backend"
            title="P0/P1 execution, compliance and security APIs"
          >
            <p>
              The customer APIs below require an authenticated tenant session.
              The worker endpoint accepts either a platform-admin session or{' '}
              <code>X-Vaani-Cron-Secret</code>.
            </p>
            <Endpoint
              method="POST"
              path="/api/app/calls"
              note="Consent + DNC + wallet gated"
            />
            <Endpoint
              method="GET · POST"
              path="/api/app/compliance"
              note="Consent, suppression and secure KYC"
            />
            <Endpoint
              method="GET · POST"
              path="/api/app/knowledge"
              note="Source ingestion and retrieval"
            />
            <Endpoint
              method="POST"
              path="/api/app/workflows/run"
              note="Durable workflow execution"
            />
            <Endpoint
              method="GET · POST"
              path="/api/app/retargeting"
              note="Consent-aware audience sync"
            />
            <Endpoint
              method="GET · POST · PATCH"
              path="/api/app/team"
              note="Invitations and tenant roles"
            />
            <Endpoint
              method="GET · POST"
              path="/api/auth/security"
              note="TOTP MFA and session revocation"
            />
            <Endpoint
              method="POST"
              path="/api/internal/jobs"
              note="Claims jobs, retries and dead letters"
            />
            <Code>{`# Never expose this secret to a browser
curl -X POST http://localhost:3000/api/internal/jobs \\
  -H 'X-Vaani-Cron-Secret: YOUR_CRON_SECRET'

# Live calls require a public HTTPS callback and secure media stream
PUBLIC_BASE_URL=https://api.yourdomain.com
VOICE_STREAM_URL=wss://voice-gateway.yourdomain.com/media
TELEPHONY_WEBHOOK_SECRET=...
EXOTEL_ACCOUNT_SID=...
EXOTEL_API_KEY=...
EXOTEL_API_TOKEN=...
EXOTEL_CALLER_ID=...`}</Code>
          </DocSection>

          <DocSection
            id="willow"
            eyebrow="10 · Connector status"
            title="Willow is a custom adapter until its calling API is identified"
          >
            <div className="rounded-2xl border border-violet-300/12 bg-violet-300/[0.035] p-5">
              <p className="text-sm font-medium">No fake vendor contract</p>
              <p className="mt-2 text-xs leading-5 text-white/45">
                The current app stores a Willow/custom base URL, account ID and
                encrypted API key, but deliberately does not send a test
                request. The connector becomes active after you supply the
                official calling API documentation: base URL, authentication
                header, create-call endpoint, inbound webhook format, status
                values and signature rules.
              </p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                'Base URL and API version',
                'API key or OAuth flow',
                'Outbound call request/response',
                'Inbound and status webhooks',
                'Retry and rate limits',
                'Webhook signature verification',
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-2 rounded-xl border border-white/7 bg-white/[0.02] p-3 text-xs text-white/48"
                >
                  <CheckCircle2 className="size-3.5 text-violet-200" /> {item}
                </div>
              ))}
            </div>
          </DocSection>

          <DocSection
            id="architecture"
            eyebrow="11 · Architecture"
            title="Backend boundaries that keep the SaaS safe"
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                [
                  'Identity',
                  'Separate portals, HttpOnly sessions, TOTP MFA, reset challenges and server-side role checks',
                ],
                [
                  'Tenant data',
                  'Every CRM, number, key, invoice and webhook query is organization-scoped',
                ],
                [
                  'Secrets',
                  'AES-GCM encrypted integration secrets; API keys stored hash-only',
                ],
                [
                  'Billing',
                  'Signed webhooks, reconciliation, refunds, idempotent events and atomic wallet updates',
                ],
                [
                  'Telephony',
                  'Public Vaani Connect abstraction with KYC and test-call activation gates',
                ],
                [
                  'Execution',
                  'Locked jobs, exponential retry, attempt history and dead-letter state',
                ],
                [
                  'Audit',
                  'Sensitive mutations record actor, organization, target and metadata',
                ],
              ].map(([title, note]) => (
                <div
                  key={title}
                  className="rounded-2xl border border-white/8 bg-[#0e1119] p-5"
                >
                  <h3 className="text-sm font-medium">{title}</h3>
                  <p className="mt-3 text-xs leading-5 text-white/38">{note}</p>
                </div>
              ))}
            </div>
          </DocSection>
        </article>
      </div>
    </main>
  );
}

function DocSection({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 border-t border-white/8 py-12 first:border-t-0 sm:py-16"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/75">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h2>
      <div className="mt-5 space-y-5 text-sm leading-7 text-white/48 [&_code]:rounded [&_code]:bg-white/6 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-cyan-100/70 [&_strong]:font-medium [&_strong]:text-white/75">
        {children}
      </div>
    </section>
  );
}
function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-2xl border border-white/8 bg-black/30 p-5 font-mono text-[10px] leading-5 text-cyan-100/68">
      <code>{children}</code>
    </pre>
  );
}
function Endpoint({
  method,
  path,
  note,
}: {
  method: string;
  path: string;
  note: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/8 bg-[#0e1119] p-4 sm:flex-row sm:items-center">
      <span className="w-fit rounded-md bg-emerald-400/10 px-2 py-1 font-mono text-[9px] font-semibold text-emerald-300">
        {method}
      </span>
      <code className="font-mono text-xs text-white/72">{path}</code>
      <span className="text-[10px] text-white/28 sm:ml-auto">{note}</span>
    </div>
  );
}
function Info({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Globe2;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-[#0e1119] p-4">
      <Icon className="size-4 text-amber-200" />
      <p className="mt-4 text-[9px] uppercase tracking-[0.14em] text-white/25">
        {label}
      </p>
      <p className="mt-2 text-xs font-medium text-white/72">{value}</p>
    </div>
  );
}
function FlowCard({
  icon: Icon,
  title,
  points,
  recommended,
}: {
  icon: typeof PhoneCall;
  title: string;
  points: string[];
  recommended?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 ${recommended ? 'border-amber-300/18 bg-amber-300/[0.035]' : 'border-white/8 bg-[#0e1119]'}`}
    >
      <div className="flex items-center justify-between">
        <Icon className="size-4 text-amber-200" />
        {recommended ? (
          <span className="rounded-full bg-amber-300 px-2 py-1 text-[8px] font-semibold text-black">
            Recommended
          </span>
        ) : null}
      </div>
      <h3 className="mt-5 text-sm font-medium text-white/78">{title}</h3>
      <div className="mt-4 space-y-2">
        {points.map((point) => (
          <div key={point} className="flex gap-2 text-xs text-white/42">
            <CheckCircle2 className="mt-1 size-3 shrink-0 text-emerald-300" />{' '}
            {point}
          </div>
        ))}
      </div>
    </div>
  );
}
