# Vaani integration and activation matrix

This file is the operator checklist for taking the local SaaS from sandbox mode to live traffic. Never place production secrets in this repository. Use the deployment secret manager or the encrypted customer integration form.

## Recommended production stack

| Capability | Primary path | Alternate path | Required configuration | Current product support |
| --- | --- | --- | --- | --- |
| Realtime AI conversation | OpenAI Realtime | Vaani Sense deterministic fallback | `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL` | Provider readiness, encrypted tenant connection, reasoning adapter and browser fallback |
| General reasoning and tool selection | OpenAI Responses | Anthropic | `OPENAI_API_KEY`, `OPENAI_MODEL` or tenant-scoped encrypted credentials | Connected provider adapter with deterministic fallback |
| India speech | Sarvam | ElevenLabs multilingual | Sarvam key/speaker or `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Hindi/Hinglish/Haryanvi routing, global voice fallback and usage metering |
| India telephony | Exotel | Vobiz / Plivo | Provider account, verified number, webhook/SIP route and KYC | Managed number, native provider import, SIP import, ownership verification and KYC workflow |
| Global telephony | Twilio | Telnyx / Vonage / Plivo | Provider account, phone number, SIP/TLS credentials | Provider selection, masked account reference, encrypted credentials and SIP route path |
| WhatsApp | Meta Cloud API | AiSensy | Business account, sender, approved templates and webhook secret | Product details, consent-aware payment link delivery, scheduled send and webhook-ready records |
| Email | Resend | Customer SMTP/custom HTTP | Sending domain and API key | Customer connector and email fallback delivery path |
| India payments | Razorpay | Stripe | API key pair, signed webhook secret and business account | Payment link workflow, invoice, credit ledger and verified webhook handlers |
| International billing | Stripe | Razorpay | Secret key and webhook signing secret | Checkout sessions, subscription metadata, top-ups and invoice reconciliation |
| Lead ads | Meta Lead Ads | Google Ads Lead Forms | OAuth app, page/form access and signed webhook | Tenant-isolated lead capture, deduplication, scoring and campaign follow-up |
| Website leads | Vaani form/widget | Custom CRM API | Allowed domains and published public form key | Popup/inline widget builder, versioned publish, public capture endpoint and CRM routing |
| CRM | HubSpot / Zoho | Salesforce / Pipedrive / custom CRM | OAuth or tenant API credential | Connector catalog, encrypted secrets and webhook/API surface |
| Automation | n8n | Zapier / Make | Webhook endpoint and signing secret | Connector catalog, API keys, outbound webhooks and retry records |
| Recording storage | S3-compatible private storage | Cloudflare R2 | Private bucket, KMS key and signed-download policy | Authenticated recording endpoint and configurable retention boundary |

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

## Data and security boundaries

- Every business record remains scoped by `organization_id`; platform admins see operational metadata, not unmasked cross-tenant conversation content.
- API keys are hashed when they only need verification and encrypted when the backend must call a provider. The UI shows only prefixes or masked account hints.
- KYC and recordings require private object storage in production. Local filenames are development-only.
- All provider callbacks must validate signatures, enforce replay/idempotency protection and enter the durable job queue before business actions run.
- Payment links and outbound messages are previews in sandbox mode. Live delivery requires configured provider credentials, customer consent and provider health.

## Not activated by repository code alone

External accounts, production API keys, telephony numbers, KYC approval, WhatsApp templates, payment gateway activation, DNS/domain verification and cloud storage credentials must be supplied by the account owner. The admin command center shows these as explicit readiness gates instead of pretending they are live.
