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

## ElevenLabs webhooks

In ElevenLabs → **Webhooks → Add endpoint**, point the endpoint at:

```
https://<your-host>/api/webhooks/elevenlabs
```

Then save the shared secret it gives you as `ELEVENLABS_WEBHOOK_SECRET` (or as
`webhookSecret` in the admin ElevenLabs config). Until it is set the endpoint
returns 503 rather than accepting unverified payloads.

Tick these two events:

| Event | What Vaani does |
|---|---|
| **Voice removal notice** | Flags every voice profile bound to that voice, and emails the workspace owner naming how many agents use it. Without this the first symptom is an agent that cannot speak. |
| **Transcription completed** | Attaches the transcript to a call when the transcription request carried `metadata.call_id`; otherwise it is stored unlinked and says so. |

*Image & Video generation* is recorded as `ignored_unsupported` — Vaani does not
use that API, and the event is kept rather than dropped so nothing is silent.

Payloads are verified as HMAC-SHA256 over `${timestamp}.${body}` from the
`ElevenLabs-Signature` header (`t=…,v0=…`), compared in constant time, with
timestamps outside 30 minutes rejected as replays. Redelivery of an event id
already seen is a no-op. `npm test` covers the verification with 11 assertions.

**Note:** Vaani's live speech-to-text is synchronous, so the transcription event
fires only for transcriptions you dispatch asynchronously with a webhook — long
recordings or a backfill.

## Media gateway (live audio)

Live audio needs a service outside this app. The worker has no WebSocket,
Durable Object or queue-consumer binding, so a media socket cannot live in it.
`services/media-gateway` is that service — see its README for details.

1. Run it, with the same `MEDIA_GATEWAY_SECRET` set on both it and this app:

```
cd services/media-gateway && npm install
VAANI_BASE_URL=https://your-vaani-host MEDIA_GATEWAY_SECRET=... npm start
```

2. Point Vaani's outbound leg at it:

```
VOICE_STREAM_URL=wss://your-gateway-host/?carrier=exotel&token=<same secret>
```

The split: the gateway owns codecs, turn detection and barge-in; Vaani owns
speech-to-text, reasoning, tools, synthesis and telemetry, behind
`POST /api/internal/voice-turn`. **The gateway holds one shared secret and no
customer credentials.**

Vaani asks the voice provider for **8 kHz mulaw**, which is exactly what
carriers stream, so no transcoding happens on the audio path. (Requesting MP3 —
the previous default — produced audio the gateway could not play at all.)

Verified locally end to end with the bundled carrier simulator: greeting
streamed as 20 ms frames, caller speech transcribed, reply synthesised and
streamed back, and the turns written to call telemetry. Measured on that run:
speech-to-text 879 ms, reasoning 1418 ms, synthesis 306 ms.

## Browser dialer

An agent can talk to an AI agent from the dashboard, with no carrier involved.
Set both of these on the app:

```
MEDIA_GATEWAY_SECRET=...            # the same value the gateway holds
MEDIA_GATEWAY_WS_URL=wss://your-gateway-host
```

**The tab never receives the gateway secret.** `POST /api/app/dialer` mints a
token bound to one call id and valid for two minutes; the gateway verifies it
with the secret it already holds. Verified: the gateway secret presented
directly as a browser token, random text, an expired token and a token signed
with a different secret are all refused with `1008` and a named reason.

`scripts/check-gateway-token-parity.mjs` proves the app's `lib/dialer-token.ts`
and the gateway's mirrored copy mint byte-identical tokens and reject the same
inputs for the same reasons — a drift there would mean the gateway accepts
tokens the app does not mint, or rejects ones it does.

What the dialer does today: microphone in, agent voice out, mute, hold, live
transcript with per-turn latency, and call telemetry written like any other
conversation. A supervisor can also **listen, whisper or join** a live call from
Live monitoring — the mode is signed into the token, and the UI always states
who can hear them. **A customer number is recorded but not dialled** — bridging a
real customer onto this leg needs a carrier, and the UI says so rather than
implying someone is on the line.

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
