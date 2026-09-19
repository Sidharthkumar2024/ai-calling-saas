import Link from 'next/link';
import { Activity, ArrowRight, Download } from 'lucide-react';
import { DocCode } from '@/components/doc-code';
export const metadata = { title: 'API documentation | Call Vani' };
const sections = [
  ['quickstart', 'Quickstart'],
  ['authentication', 'Authentication'],
  ['leads', 'Lead API'],
  ['sms', 'SMS send'],
  ['credits', 'Wallet'],
  ['forms', 'Forms & widgets'],
  ['webhooks', 'Webhooks'],
  ['errors', 'Errors & retries'],
  ['billing', 'Usage & billing'],
  ['integrations', 'Integration setup'],
] as const;
const leadExample = `# Set these on your server. Never expose API keys in browser code.
export CALL_VANI_ORIGIN="https://YOUR_DEPLOYMENT_HOST"
export CALL_VANI_API_KEY="vaani_live_YOUR_KEY"

curl --fail-with-body "$CALL_VANI_ORIGIN/api/v1/leads" \\
  -H "Authorization: Bearer $CALL_VANI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"sourceType":"manual","externalLeadId":"crm-1042",
       "name":"Aarav Mehta","phone":"+919876543210",
       "productInterest":"Product demo","notes":"Requested a callback"}'`;
const smsExample = `# Session-authenticated app endpoint, for workspace users.
# Public bearer-key SMS v1 is intentionally not exposed yet.
curl --fail-with-body "$CALL_VANI_ORIGIN/api/app/sms" \\
  -H "Content-Type: application/json" \\
  -b "YOUR_APP_SESSION_COOKIE" \\
  -d '{"to":"+919876543210","message":"Hi Aarav, your Call Vani demo is confirmed."}'`;
const verifier = `import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWebhook(rawBody, header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const match = /^t=(\\d+),v1=([a-f0-9]{64})$/.exec(header);
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) ||
      Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = createHmac('sha256', secret)
    .update(match[1] + '.').update(rawBody).digest();
  const received = Buffer.from(match[2], 'hex');
  return received.length === expected.length &&
    timingSafeEqual(received, expected);
}
// Pass the exact raw request bytes BEFORE parsing JSON.
// Verify X-Vaani-Signature, then deduplicate payload.id durably.
// Return 2xx only after your queue has durably accepted the event.`;
function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-hairline py-10">
      <h2 className="mb-5 text-2xl font-semibold tracking-tight">{title}</h2>
      <div className="space-y-5 text-base leading-7 text-ink-body">
        {children}
      </div>
    </section>
  );
}
function Endpoint({
  method,
  path,
  scope,
}: {
  method: string;
  path: string;
  scope: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-surface-muted p-4">
      <span className="rounded-md bg-primary px-2 py-1 text-sm font-semibold text-primary-foreground">
        {method}
      </span>
      <code className="break-all text-sm">{path}</code>
      <span className="text-sm text-ink-muted">{scope}</span>
    </div>
  );
}
export default function DocsPage() {
  return (
    <main className="cv-api-docs min-h-screen bg-surface text-ink">
      <header className="sticky top-0 z-40 border-b border-hairline bg-surface/95 backdrop-blur">
        <div className="mx-auto flex min-h-20 max-w-[1320px] items-center gap-3 px-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-semibold"
          >
            <Activity className="size-8 text-primary" />
            Call Vani
          </Link>
          <span className="hidden text-sm text-ink-muted sm:inline">
            Developers
          </span>
          <Link
            href="/login"
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Open app
            <ArrowRight size={16} />
          </Link>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1320px] lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="border-b border-hairline p-4 lg:sticky lg:top-20 lg:h-[calc(100svh-5rem)] lg:border-r lg:p-6">
          <nav
            aria-label="Documentation"
            className="flex flex-wrap gap-2 lg:flex-col"
          >
            {sections.map(([id, label]) => (
              <a
                key={id}
                href={'#' + id}
                className="rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-surface-muted"
              >
                {label}
              </a>
            ))}
          </nav>
          <Link
            href="/docs/openapi.json"
            className="mt-5 inline-flex items-center gap-2 px-3 text-sm font-medium text-primary"
          >
            <Download size={16} />
            OpenAPI 3.1 JSON
          </Link>
        </aside>
        <article className="min-w-0 px-4 py-10 sm:px-8 lg:px-12">
          <p className="text-sm font-medium text-primary">
            API v1 · reviewed 8 September 2026
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            From your systems
            <br />
            to the next conversation.
          </h1>
          <p className="my-6 max-w-2xl text-lg leading-8 text-ink-muted">
            Capture leads, read your workspace wallet and receive signed lead
            events. These examples describe the endpoints implemented in this
            build.
          </p>
          <p className="mb-8 rounded-xl border border-hairline bg-surface-muted p-4 text-sm leading-6">
            Base URL:{' '}
            <code className="break-all">
              https://YOUR_DEPLOYMENT_HOST/api/v1
            </code>
            . For local testing use <code>http://localhost:3000/api/v1</code>.
            There is no public call-creation API in v1.
          </p>
          <Section id="quickstart" title="01 / Send your first lead">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Sign in and configure the lead source in your workspace.</li>
              <li>
                Open Integrations &amp; API → API keys. Create a server-side key
                with <code>leads:write</code>.
              </li>
              <li>
                Save the secret when shown, then run this request on your
                server.
              </li>
            </ol>
            <DocCode>{leadExample}</DocCode>
            <p>
              Success is HTTP 201 with <code>{'{ "data": { …lead } }'}</code>.
              Scoring is currently rule-based. A queued call job is not proof
              that a telephone call was placed; provider setup, consent, balance
              and execution gates still apply.
            </p>
          </Section>
          <Section id="authentication" title="02 / Authentication & scopes">
            <p>
              Send <code>Authorization: Bearer vaani_live_…</code>. Keys are
              shown once, hashed at rest, customer-scoped and revocable. Create
              separate keys per server and give each only the required scope.
              Never put a private key in a website, mobile bundle, URL or log.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {['leads:read', 'leads:write', 'credits:read'].map((scope) => (
                <code
                  className="rounded-xl bg-surface-muted p-4 text-sm"
                  key={scope}
                >
                  {scope}
                </code>
              ))}
            </div>
            <p>
              <code>calls:write</code> is reserved; no v1 route consumes it.{' '}
              <code>/api/app/*</code> and <code>/api/admin/*</code> are
              session-authenticated interfaces, not public bearer-key APIs.
              Revoke and replace a leaked key immediately.
            </p>
          </Section>
          <Section id="leads" title="03 / Lead API">
            <Endpoint method="POST" path="/api/v1/leads" scope="leads:write" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead>
                  <tr>
                    <th className="py-3">Field</th>
                    <th>Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    [
                      'sourceType',
                      'Required: meta_ads, google_ads, website_form or manual',
                    ],
                    ['name', 'Required string; trimmed length at least 2'],
                    [
                      'phone',
                      'Required string; at least 8 characters. Send international format.',
                    ],
                    [
                      'externalLeadId',
                      'Optional stable source ID for deduplicating the lead row',
                    ],
                    [
                      'email / campaignName / productInterest / notes',
                      'Optional strings',
                    ],
                    [
                      'estimatedValue',
                      'Optional nonnegative number, rounded to an integer',
                    ],
                  ].map(([f, d]) => (
                    <tr className="border-t border-hairline" key={f}>
                      <td className="py-3 pr-4 font-mono">{f}</td>
                      <td>{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              POST returns camelCase fields including{' '}
              <code>capturedAt, summary, callJobId, opportunityId</code>;{' '}
              <code>source</code> is the source display name. A repeated
              external ID returns the existing lead ID, but is not a general
              idempotency guarantee: webhook events may repeat. Deduplicate in
              your receiver too.
            </p>
            <Endpoint method="GET" path="/api/v1/leads" scope="leads:read" />
            <p>
              Returns <code>{'{ data: [...] }'}</code> with the newest 100
              leads. No pagination or query filters are implemented. List fields
              include{' '}
              <code>
                id, name, phone, email, status, score, intent, ai_summary,
                captured_at, source
              </code>
              . Here <code>source</code> is the source type. Note the casing
              difference from POST.
            </p>
            <DocCode>
              {
                'curl "$CALL_VANI_ORIGIN/api/v1/leads" -H "Authorization: Bearer $CALL_VANI_API_KEY"'
              }
            </DocCode>
          </Section>
          <Section id="sms" title="04 / SMS send">
            <Endpoint
              method="POST"
              path="/api/app/sms"
              scope="Workspace session · campaigns.manage"
            />
            <p>
              SMS is available inside the authenticated app for workspaces that
              connect a BYO <code>sms_gateway</code> integration. This endpoint
              holds wallet credits before sending, finalizes when the provider
              accepts the message and releases the hold for sandbox/no-provider
              or provider rejection.
            </p>
            <DocCode>{smsExample}</DocCode>
            <p>
              First version charges one <code>sms_message</code> event per
              submitted message. Provider segment-count reconciliation belongs
              in the delivery webhook and is not exposed as a public API yet.
              If no SMS gateway is connected, the API returns sandbox delivery
              and releases the wallet hold.
            </p>
          </Section>
          <Section id="credits" title="05 / Wallet balance">
            <Endpoint
              method="GET"
              path="/api/v1/credits"
              scope="credits:read"
            />
            <DocCode>
              {
                'curl "$CALL_VANI_ORIGIN/api/v1/credits" -H "Authorization: Bearer $CALL_VANI_API_KEY"'
              }
            </DocCode>
            <p>Example response:</p>
            <DocCode>
              {
                '{"data":{"balance":100,"low_balance_threshold":20,"updated_at":"2026-09-08 10:00:00"}}'
              }
            </DocCode>
            <p>
              When no wallet exists, balance and threshold are zero and{' '}
              <code>updated_at</code> is omitted. A credit is a usage unit, not
              one rupee or one minute. Do not derive a charge from balance
              alone.
            </p>
            <p>
              In-app usage charges use a hold → finalize → release model.
              Current billable ids include inbound call minute, outbound call
              minute, AI voice minute, test call, WhatsApp marketing template,
              WhatsApp utility/authentication template, WhatsApp service reply,
              SMS message, email send and recording storage. Workspace admins
              can view the exact live rate card in Billing.
            </p>
          </Section>
          <Section id="forms" title="06 / Website forms & widgets">
            <p>
              Create an active form under Lead Capture. Configure its allowed
              origins, fields, logo, theme and display trigger. The generated
              embed uses a public form key, never an API key.
            </p>
            <DocCode>
              {
                '<script src="https://YOUR_DEPLOYMENT_HOST/api/widget/YOUR_PUBLIC_FORM_KEY" defer></script>'
              }
            </DocCode>
            <Endpoint
              method="POST"
              path="/api/forms/{publicKey}/leads"
              scope="Public form key + configured origin policy"
            />
            <p>
              Submit JSON matching the form fields; name and phone are required.
              Success: <code>{'{"accepted":true,"leadId":"…","score":0}'}</code>
              . Active form required; 64 KiB payload cap and 20 requests/hour
              per form/fingerprint. Allowed origins are not authentication: a
              request without Origin is currently permitted. Add edge bot
              protection for public campaigns.
            </p>
            <p>
              Widget JavaScript returns 404 for a missing/unpublished form and
              422 for invalid configuration. Saving an active form updates its
              live embed; a separate draft/publish snapshot is not yet
              supported. Voice widgets have a separate setup flow and are not
              the lead-form endpoint.
            </p>
          </Section>
          <Section id="webhooks" title="07 / Signed lead webhooks">
            <p>
              Add an HTTPS receiver under Integrations &amp; API → Webhooks. The
              currently emitted events are <code>lead.created</code> and{' '}
              <code>lead.qualified</code> (score ≥75), from v1 lead POST. Call,
              appointment and low-credit event names may appear in settings but
              are not emitted in this build. Forms and provider ingestion do not
              yet emit these outbound events.
            </p>
            <DocCode>
              {
                'Content-Type: application/json\nX-Vaani-Event: lead.created\nX-Vaani-Signature: t=UNIX_SECONDS,v1=HEX_DIGEST\n\n{"id":"event_…","type":"lead.created","createdAt":"2026-09-08T04:30:00Z","data":{"lead":{"id":"lead_…"}}}'
              }
            </DocCode>
            <DocCode>{verifier}</DocCode>
            <p>
              Failed initial deliveries enqueue up to eight worker attempts with
              exponential backoff and a dead-letter state. A running job
              processor is required. Retries keep the event ID and body but
              receive a fresh signature timestamp. Acknowledge quickly, process
              asynchronously, and use durable event-ID deduplication.
            </p>
          </Section>
          <Section id="errors" title="08 / Errors, retries & limits">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>400:</strong> invalid lead JSON, fields, source or
                ingestion failure. Response:{' '}
                <code>{'{"error":"message"}'}</code>.
              </li>
              <li>
                <strong>401:</strong> missing, invalid, revoked or
                insufficient-scope API key.
              </li>
              <li>
                <strong>404 / 413 / 429:</strong> public form missing, body too
                large or rate limited. Form preflight refusal can return 403.
              </li>
              <li>
                <strong>5xx / network timeout:</strong> acceptance may be
                uncertain. Check the result before retrying a write; use stable
                external IDs and receiver deduplication.
              </li>
            </ul>
            <p>
              Public v1 currently has no per-key rate limit, pagination, key
              expiry or stable machine error-code contract. Lead v1 validates
              phone length rather than strict E.164 and does not enforce an
              explicit body-size limit. Keep keys server-side and apply a
              gateway limit before public production exposure.
            </p>
          </Section>
          <Section id="billing" title="09 / Billing units & payment state">
            <p>
              New monthly plans: Launch ₹2,999; Growth ₹9,999; Scale ₹24,999.
              Usage is separate. New credit packs cost ₹1.90/credit; existing
              subscriptions and prepaid balances remain unchanged. Taxes,
              carrier charges, numbers and premium provider costs are separate.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Text playground: 10 credits per turn.</li>
              <li>
                Realtime browser playground: <code>realtime_session_v1</code>,
                10 credits per session reservation—not per minute. Known
                rejection releases the reservation; uncertain acceptance
                requires review and never triggers automatic paid fallback.
              </li>
              <li>
                Current Exotel completed-call handler: 10 credits per started
                minute, minimum one minute. Other voice paths are not uniformly
                metered; production usage settlement is still under validation.
              </li>
            </ul>
            <p>
              Payment acceptance is not fulfillment. Credits are granted after a
              verified paid event; delayed methods wait for payment success. Do
              not add credits based on a browser redirect. The ₹19 standard
              AI-minute target and provider-cost scenarios are planning figures
              until each voice route has validated duration metering.
            </p>
          </Section>
          <Section id="integrations" title="10 / Connect the right account">
            <p>
              Customers connect their own accounts from Integrations; platform
              operators configure provider credentials privately. Never share
              platform secrets in client embeds or public documentation.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Meta leads:</strong> provider callback under{' '}
                <code>/api/integrations/meta/leads?workspace=…</code>;
                verification challenge and raw-body signature validation.
                Requires the workspace’s configured assets.
              </li>
              <li>
                <strong>Google lead forms:</strong> workspace-scoped provider
                callback with the configured lead-form key.
              </li>
              <li>
                <strong>WhatsApp:</strong> verify customer business/phone assets
                and opt-in. Outside the rolling customer-service window,
                approved templates are required. Marketing is not generally
                free.
              </li>
              <li>
                <strong>Voice:</strong> configure the provider, agent, language,
                consent and carrier. Browser microphone permission and secure
                HTTPS are required outside localhost.
              </li>
            </ul>
            <p>
              Need a key or connection?{' '}
              <Link
                href="/login"
                className="font-medium text-primary underline"
              >
                Open your workspace
              </Link>
              . Review{' '}
              <Link href="/privacy" className="underline">
                Privacy
              </Link>{' '}
              and{' '}
              <Link href="/terms" className="underline">
                Terms
              </Link>{' '}
              before processing customer data.
            </p>
          </Section>
        </article>
      </div>
    </main>
  );
}
