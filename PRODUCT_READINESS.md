# Vaani product readiness

This file separates working localhost product behavior from provider-dependent production activation. A polished screen is not counted as a live carrier, payment or messaging integration.

## Built in the current product

| Area | Status | Included behavior |
| --- | --- | --- |
| Landing and onboarding | Working locally | Responsive Hindi/English landing page, agent examples, signup flow, separate customer/admin login, Google button visible but admin-disabled |
| Multi-tenancy and access | Working locally | Organization-scoped queries, separate customer/admin roles and URLs, HttpOnly sessions, password hashing, logout, encrypted integration secrets, hash-only API keys |
| Trial playground | Working locally | Text and browser-voice modes, English/Hindi/Hinglish/Haryanvi behavior, 100 signup credits, 10 credits deducted per conversational turn, tool-action previews |
| Lead capture and CRM | Working locally | Meta/Google/form/manual source model, public website-form endpoint, API lead ingestion, normalization, deduplication, AI score/intent, pipeline and activities |
| Agent building | Working locally | Agent Studio, language/voice/intelligence settings, tools, extractions, calling config and graph-agent records |
| Campaigns | Working locally | Tenant campaign records, audience size, concurrency, retry policy, calling window and outcome metrics |
| Telephony control | Connection-ready | My Numbers/KYC flows, platform-rented and BYO number model, SIP trunk registration, transport/media/codec settings and test-gated status |
| Knowledge and automation | Working locally | Knowledge bases, event-triggered workflows, graph agents and durable scheduled payment actions |
| Call intelligence | Working locally with demo media | Call history, summaries, transcripts/analysis records, live-monitor view, tenant-authorized demo audio endpoint, analytics, reports and costs |
| AI quality assurance | Working locally | Resolution, knowledge, naturalness and policy scores; hallucination and overlap counters; pass/review status |
| Alerting | Working locally | Rules, thresholds, windows, frequencies, email/webhook channel model and incidents |
| Revenue actions | Sandbox-ready | Razorpay payment-link adapter, WhatsApp immediate/scheduled delivery model, CRM audit trail and signed payment-webhook path |
| Billing | Sandbox-ready | Free/Growth/Scale plans, wallet and ledger, credit top-ups, subscriptions, invoices and Stripe webhook lifecycle |
| Developer platform | Working locally | API keys/scopes, public lead API, website forms, signed outgoing webhooks and in-product docs |
| Support | Working locally | Customer ticket creation/thread and admin queue/reply/resolve flow |
| Platform admin | Working locally | Tenant, user, number/KYC, plan, invoice, trial, provider requirement, auth visibility, support and audit controls |

## Needed before real calls or public launch

| Priority | Work left | What is required |
| --- | --- | --- |
| P0 | Production database and migrations | Provision production D1/Postgres, run migrations, backups, point-in-time recovery and tenant isolation tests |
| P0 | Speech and reasoning credentials | Configure the selected STT/TTS/realtime and reasoning keys (for example Vaani Voice India and Vaani Sense backend adapters), quotas, timeout/failover and cost telemetry |
| P0 | Telephony carrier | Provision Exotel/Vobiz/Plivo/Twilio or a SIP carrier, DIDs, inbound/outbound routes, status webhooks, concurrency limits, KYC and ownership evidence |
| P0 | Compliance | Legal review for consent, DNC/TRAI rules, DLT templates where applicable, recording disclosure, deletion/export, data residency and industry restrictions |
| P0 | Secure recording storage | Bind R2/S3, encrypt objects, issue short-lived signed playback URLs, retention deletion jobs and access audit logs |
| P0 | Background execution | Production queue/workflow workers for calls, retries, scheduled messages, reports, alerts and webhook delivery with dead-letter handling |
| P0 | Payments | Add production Razorpay/Stripe credentials, verify signed webhooks, configure GST/tax/invoice numbering, refunds and reconciliation |
| P1 | WhatsApp production | Meta business verification, phone-number ID, approved templates, opt-in proof, rate limits and delivery-status webhooks |
| P1 | Google sign-in | Create OAuth client and callback URL, store secrets, validate state/nonce/PKCE and then enable it from admin |
| P1 | Meta and Google lead ads | Complete OAuth apps, webhook verification, lead-form selection, token refresh, attribution mapping and deletion callbacks |
| P1 | Provider connection tests | Replace `testing_required` with active only after authenticated test calls and webhook round trips succeed |
| P1 | Observability and security | Central logs/traces/metrics, error monitoring, WAF/rate limits, security headers, secret rotation, dependency scanning and incident alerts |
| P1 | Production auth | Email verification, password reset, MFA for admins, session revocation, granular RBAC and optional enterprise SSO |
| P1 | QA calibration | Human-reviewed evaluation set per language/use case, score thresholds, false-positive review and regression tests |
| P2 | Mobile apps | Native Android and iOS apps remain phase two; responsive web portal is the current client |
| P2 | Enterprise capabilities | SSO/SCIM, custom retention, audit export, data residency, SLA, dedicated clusters and advanced role permissions |

## External credentials and services checklist

- Speech/realtime provider API key and regional endpoint
- Reasoning/model provider API key
- Telephony carrier credentials, SIP gateway and webhook secrets
- Razorpay and/or Stripe production keys and signing secrets
- WhatsApp Cloud/AiSensy token, phone-number ID and approved templates
- Google OAuth client ID, client secret and redirect URI
- Meta Lead Ads and Google Ads OAuth application credentials
- R2/S3 recording bucket, encryption and signed-URL configuration
- Transactional email provider and verified sending domain
- Public HTTPS domain, DNS, TLS, WAF and rate limiting
- Error monitoring, OpenTelemetry/log drain and uptime alerting

White-label functionality is intentionally excluded from this release.
