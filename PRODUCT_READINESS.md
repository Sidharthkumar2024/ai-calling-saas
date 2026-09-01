# Vaani product readiness

This inventory distinguishes implemented software from external activation. P0 and P1 backend scope is implemented and connection-ready; carrier accounts, API credentials, KYC approval and legal sign-off remain deployment gates—not missing application code.

## P0 — implemented

| Area | Status | Backend behavior |
| --- | --- | --- |
| Multi-tenant core | Complete | Organization-scoped data access, separate admin/customer portals, role checks, audit events and encrypted tenant secrets |
| Durable execution | Complete | D1 job queue with idempotency keys, priority, claiming locks, exponential retry, attempt history and dead-letter status |
| Voice/reasoning adapters | Connection-ready | Private Vaani provider layer for Sarvam speech and Anthropic reasoning; strict Hindi/Haryanvi/Hinglish prompts, real provider TTS, measured latency, credential checks and an honestly labelled browser fallback |
| Live telephony | Connection-ready | Consent/DNC/wallet-gated outbound call API, Exotel bidirectional AI stream adapter, authenticated callbacks, usage charging and failure state |
| Numbers, SIP and KYC | Complete | BYO/platform numbers, OTP ownership flow, SIP trunk configuration, secure KYC document metadata and R2 upload path |
| Recording vault | Connection-ready | Private R2 binding, tenant-authorized playback, remote recording ingestion and local demo fallback |
| Compliance | Complete | Explicit consent evidence, revocation, hashed suppression list, recording policy, retention settings and audit trail |
| Payments and billing | Connection-ready | Razorpay payment links/refunds/reconciliation, raw-body HMAC webhooks, Stripe checkout lifecycle, wallet/ledger, plans, GST-ready invoices |
| Commerce orchestration | Complete | Instant/scheduled WhatsApp payment delivery, transactional-email fallback, durable execution, CRM state and provider-confirmed status |
| Lead capture and CRM | Complete | Meta/Google/form/API/manual ingestion, validation, dedupe, scoring, attribution, CSV import, editable popup builder, versioned publish/unpublish, domain allowlist, generated embed script, opportunity pipeline and activities |

## P1 — implemented

| Area | Status | Backend behavior |
| --- | --- | --- |
| Authentication security | Complete | PBKDF2 passwords, HttpOnly sessions, login/signup rate limits, password reset challenges, session revocation and TOTP MFA |
| Google sign-in | Connection-ready | Admin visibility/activation controls, OAuth state, PKCE, server-side code exchange and verified Google identity for existing accounts |
| Integrations | Connection-ready | Encrypted adapters/configuration for CRM, telephony, ads, calendar, automation, commerce, sheets and messaging with test endpoint |
| Knowledge base | Complete | Tenant sources, safe public-URL/text ingestion, content hashing, chunking, lexical retrieval and durable indexing state |
| Workflows and graph agents | Complete | Versioned graph records, triggerable workflow runs, step history, queued execution and failure accounting |
| Campaigns and retargeting | Complete | Campaign policy/configuration, contact execution model, consent-aware audiences and durable destination sync |
| Call intelligence | Complete | History, transcripts, summaries, recordings, live monitor, outcomes, cost, disconnect reason and informative charts |
| QA, alerts and reports | Complete | Multidimensional QA, hallucination/overlap checks, alert rules/incidents, durable evaluation jobs and scheduled report definitions |
| Developer platform | Complete | Scoped API keys, lead/form APIs, signed outgoing webhooks, automatic retry/dead-letter delivery and in-product docs |
| Support and admin control | Complete | Ticket threads, admin reply/assignment/status, tenant/billing/provider/auth governance and operator observability |
| Provider economics | Complete | Usage/cost/latency event schema and admin cost/margin data feed |

## External activation gates

These require accounts, approvals or business decisions outside the repository:

- Add production Sarvam and Anthropic keys, a supported model ID, quotas and budget alerts.
- Run the bidirectional STT/reasoning/TTS WebSocket gateway close to the telephony region for true full-duplex barge-in. The localhost playground uses connected server reasoning/TTS when configured and a clearly labelled browser fallback otherwise.
- Provision Exotel/SIP numbers, complete carrier KYC, configure the public HTTPS callback and validate a real bidirectional stream.
- Bind the private R2 bucket and set lifecycle/retention policies.
- Add Razorpay/Stripe live keys, approved WhatsApp templates and Meta business verification.
- Register Google OAuth, Meta Lead Ads and Google Ads applications and their production callback URLs.
- Complete TRAI/DLT, consent wording, recording disclosure, privacy/deletion and industry-specific legal review.
- Configure a transactional email provider, DNS/TLS/WAF, centralized logs/traces and on-call alerts.

## Voice latency expectations

- Local fallback: browser speech recognition and system voice; useful for UI testing, not a production latency benchmark.
- Connected request/response playground: short reasoning plus server TTS, with latency shown per turn. Exact result depends on model, region and provider quota.
- Production realtime target: streaming STT → short streaming reasoning → streaming TTS through the WebSocket media gateway, with barge-in and regional routing. Validate p50/p95 under load before enabling paid calls.

## P2 — intentionally left

- Native Android and iOS applications.
- Enterprise SSO/SCIM, dedicated clusters and white-label capabilities.

White-label remains intentionally excluded from this release.
