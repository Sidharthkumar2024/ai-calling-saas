# Vaani integration and activation matrix

This file is the operator checklist for taking the local SaaS from sandbox mode to live traffic. Never place production secrets in this repository. Use the deployment secret manager or the encrypted customer integration form.

## Recommended production stack

| Capability                           | Primary path                  | Alternate path                      | Required configuration                                                  | Current product support                                                                        |
| ------------------------------------ | ----------------------------- | ----------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Realtime AI conversation             | OpenAI Realtime               | Vaani Sense deterministic fallback  | `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL`                               | Provider readiness, encrypted tenant connection, reasoning adapter and browser fallback        |
| General reasoning and tool selection | OpenAI Responses              | Anthropic                           | `OPENAI_API_KEY`, `OPENAI_MODEL` or tenant-scoped encrypted credentials | Connected provider adapter with deterministic fallback                                         |
| India speech                         | Sarvam                        | ElevenLabs multilingual             | Sarvam key/speaker or `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`       | Hindi/Hinglish/Haryanvi routing, global voice fallback and usage metering                      |
| India telephony                      | Exotel                        | Vobiz / Plivo                       | Provider account, verified number, webhook/SIP route and KYC            | Managed number, native provider import, SIP import, ownership verification and KYC workflow    |
| Global telephony                     | Twilio                        | Telnyx / Vonage / Plivo             | Provider account, phone number, SIP/TLS credentials                     | Provider selection, masked account reference, encrypted credentials and SIP route path         |
| WhatsApp                             | Meta Cloud API                | AiSensy                             | Business account, sender, approved templates and webhook secret         | Product details, consent-aware payment link delivery, scheduled send and webhook-ready records |
| Email                                | Resend                        | Customer SMTP/custom HTTP           | Sending domain and API key                                              | Customer connector and email fallback delivery path                                            |
| India payments                       | Razorpay                      | Stripe                              | API key pair, signed webhook secret and business account                | Payment link workflow, invoice, credit ledger and verified webhook handlers                    |
| International billing                | Stripe                        | Razorpay                            | Secret key and webhook signing secret                                   | Checkout sessions, subscription metadata, top-ups and invoice reconciliation                   |
| Lead ads                             | Meta Lead Ads                 | Google Ads Lead Forms               | OAuth app, page/form access and signed webhook                          | Tenant-isolated lead capture, deduplication, scoring and campaign follow-up                    |
| Website leads                        | Vaani form/widget             | Custom CRM API                      | Allowed domains and published public form key                           | Popup/inline widget builder, versioned publish, public capture endpoint and CRM routing        |
| CRM                                  | HubSpot / Zoho                | Salesforce / Pipedrive / custom CRM | OAuth or tenant API credential                                          | Connector catalog, encrypted secrets and webhook/API surface                                   |
| Automation                           | n8n                           | Zapier / Make                       | Webhook endpoint and signing secret                                     | Connector catalog, API keys, outbound webhooks and retry records                               |
| Recording storage                    | S3-compatible private storage | Cloudflare R2                       | Private bucket, KMS key and signed-download policy                      | Authenticated recording endpoint and configurable retention boundary                           |

## Phone number activation flow

1. Customer chooses a managed number, native carrier import, or SIP trunk import.
2. Vaani stores only the provider name and a masked account/trunk reference in the number record. Provider secrets go to the encrypted integration vault.
3. Ownership is verified by OTP or provider challenge.
4. Customer submits business identity, address, authorized-signatory and use-case evidence through the KYC vault.
5. Admin reviews the number, documents, expected monthly volume and permitted use case.
6. On approval the number becomes active; rejection returns the request to `changes_required` with an auditable decision.
7. Before live traffic, configure signed telephony webhooks, TLS/SRTP where supported, consent checks, suppression lists, recording notice and regional retention.

## Admin activation gates

- OpenAI: create a restricted production project key, set credit/rate limits, configure the realtime and reasoning model names, then run the provider health check.
- ElevenLabs: create a restricted key, set a credit quota and optional IP allowlist, select a multilingual voice ID, then run a test synthesis. Do not expose the provider key to the browser.
- Telephony: verify the business and number with the carrier; configure inbound/outbound webhooks or SIP; validate codecs, TLS, caller ID and concurrency.
- WhatsApp/email: approve sender identity and templates; verify webhook signatures; keep per-contact consent and opt-out records.
- Payments: use live keys only in the secret manager; verify signed webhooks; reconcile payment, invoice and credit-ledger entries idempotently.
- Storage: use a private bucket, per-object authorization, encryption at rest, short-lived downloads and an explicit retention job.
- Observability: export structured logs and traces without raw credentials or unrestricted transcript content; alert on latency, call failures, webhook retries and credit anomalies.

## Inbound calling

Vaani resolves inbound calls but does not bridge audio. A carrier — or the media
gateway in front of it — posts the call to:

```
POST /api/webhooks/telephony/inbound
header: x-vaani-inbound-secret: $INBOUND_WEBHOOK_SECRET
body:   {"to": "+9198…", "from": "+9198…", "CallSid": "<carrier call id>"}
```

Set `INBOUND_WEBHOOK_SECRET` first (`openssl rand -hex 32`); without it the
endpoint returns 503 rather than accepting unauthenticated calls.

The response resolves the dialled number against `number_routes` (highest
priority first) and reports one of:

| action | meaning |
|---|---|
| `connect_agent` | bridge the caller to the named AI voice agent |
| `enqueue` | a human queue has someone available |
| `voicemail` / `callback` / `reject` | nobody is on shift; the route's `off_hours_action` |
| `no_route` | the number has no active route |
| `unknown_number` | no workspace owns that number |

It opens the `call_records` row, is idempotent on the carrier's call id so a
retry does not create a second call, and always returns `mediaBridged: false` —
**audio is the gateway's job.** This worker has no WebSocket, Durable Object or
queue-consumer binding, so a media socket cannot live here; that requires a
separate service.

Outbound calling is gated the same way on `VOICE_STREAM_URL` (a `wss://` URL);
`POST /api/app/calls` returns 503 without it, and the campaign dialer records
`telephony_unconfigured` instead of reporting a dial it could not make.

## Scheduler (required — background work does not run without it)

The durable job queue (`lib/job-queue.ts`) has no self-starting timer. Alerts, retention
enforcement and scheduled reports only run when something calls the tick endpoint:

```
POST /api/internal/jobs      header: x-vaani-cron-secret: $CRON_SECRET
```

**There is no Cloudflare cron trigger, deliberately.** The worker entry
(`vinext/server/fetch-handler`) exports only `fetch` — it has no `scheduled` handler — so a
`triggers.crons` entry would fire against nothing. An external scheduler is the supported path.

1. Set `CRON_SECRET` in the server environment. Generate one with:
   `openssl rand -hex 32`. Without it the endpoint falls back to requiring a
   signed-in platform-admin session, so no unattended scheduler can drive it.
2. Point any scheduler at the repo script every 5 minutes:

```
*/5 * * * * cd /path/to/vaani && CRON_SECRET=... VAANI_BASE_URL=https://your-host npm run jobs:tick
```

   The script (`scripts/run-jobs.mjs`) exits non-zero when the tick fails **or** when a job
   in the batch failed, so cron mail / an uptime monitor surfaces it.

What each tick does: enqueues due scheduled actions, enqueues hourly maintenance
(`alerts.evaluate`, `retention.enforce`, plus due `report.generate`), then drains up to 25 jobs.

Alert rules are evaluated against real telemetry — `p95_latency_ms` (true 95th percentile over
`provider_usage_events`), `call_failure_rate`, `qa_not_passed_rate`, `queue_backlog` and
`provider_error_rate` — over each rule's own `window_minutes`. A breach opens one incident (not
one per tick) and writes an `outbound_messages` row per configured channel; the incident is
resolved automatically when the metric recovers. A rule naming an unsupported metric is
reported in the job result's `skippedMetrics` rather than being silently ignored.

## Data and security boundaries

- Every business record remains scoped by `organization_id`; platform admins see operational metadata, not unmasked cross-tenant conversation content.
- API keys are hashed when they only need verification and encrypted when the backend must call a provider. The UI shows only prefixes or masked account hints.
- KYC and recordings require private object storage in production. Local filenames are development-only.
- All provider callbacks must validate signatures, enforce replay/idempotency protection and enter the durable job queue before business actions run.
- Payment links and outbound messages are previews in sandbox mode. Live delivery requires configured provider credentials, customer consent and provider health.

## Not activated by repository code alone

External accounts, production API keys, telephony numbers, KYC approval, WhatsApp templates, payment gateway activation, DNS/domain verification and cloud storage credentials must be supplied by the account owner. The admin command center shows these as explicit readiness gates instead of pretending they are live.
