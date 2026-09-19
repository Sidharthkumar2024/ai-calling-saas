# Call Vani live completion ledger — 19 September 2026

This ledger reconciles the conversation, WHATS_LEFT.md, PRODUCT_READINESS.md,
and the September 12 feature flow with production evidence. Historical claims
of local completion do not establish production activation.

## Verified this session

- VPS app and media systemd services: active; checkout `10068a6`.
- App service passes `/etc/callvani/app.env` to Wrangler explicitly.
- Direct VPS customer password login: HTTP 200.
- Direct VPS database health: healthy.
- Google provider row now exists, visible but disabled.
- Siddharth workspace: no numbers and no integration connections.
- Workspace agent Tara: draft, inbound/outbound false, no voice profile.
- Vobiz console independently shows one active number +918071582881 and INR 25 balance; this number is absent from the fresh VPS workspace.
- Domain DNS still returns VPS 129.121.139.191 and old host 172.66.3.26.

## Pending, in execution order

| Priority | Area | Remaining work / acceptance evidence |
|---|---|---|
| P0 | Domain and TLS | Remove obsolete root A destination, verify authoritative DNS, install/verify VPS TLS for root and www, confirm HTTPS reaches VPS. |
| P0 | Google sign-in | Save existing OAuth client credentials encrypted, enable provider, confirm consent/test-user availability, test callback and session on live domain. |
| P0 | Account access | Verify customer and admin login through final HTTPS domain, role separation, logout and reset-password email delivery. |
| P0 | Vobiz | Connect purchased account to Siddharth workspace; verify owned outbound number, balance and permissions; bind number to agent. Do not treat purchase as app connection. |
| P0 | Voice | Connect available STT, reasoning and TTS credentials; test Hindi/English male/female samples; select measured quality and latency. No provider currently has verified production health. |
| P0 | Media/webhooks | Verify HTTPS answer/status callbacks, public WSS gateway, shared secret, signature validation and bidirectional audio. |
| P0 | Test call | Activate configured agent, dial user-authorized +917510020067 once ready, record provider UUID, ringing/answer/end status and two-way audio result. No live call completed yet. |
| P1 | GitHub private repo | Add read-only VPS deploy key, switch origin to SSH, verify fetch after privatization. Current public-HTTPS updater is not sufficient for private repo. |
| P1 | Email | Save SMTP encrypted, verify TLS/auth, deliver forgot-password message and consume reset link successfully. |
| P1 | Payments / bank | Admin Razorpay and Stripe configuration, verified webhook receipts, checkout, wallet fulfillment, refund and duplicate-event protection. Bank-transfer details/proof review and reconciliation require configuration and end-to-end verification. |
| P1 | Billing | Verify method-specific fees, UPI policy, tax, plan activation/cancel/suspension, usage ledger and no duplicate carrier charges for BYO accounts. Provider rates and permissible surcharges must be verified before publication. |
| P1 | Siddharth agent | Populate approved services/resume knowledge, natural AI-disclosed greeting, qualification, opt-out, appointment/human handoff and supported answers. |
| P1 | Branding/UI | Verify final-domain logo/favicon, Google icon, mobile layouts, browser dialer and every admin/customer navigation action. |
| P2 | WhatsApp | Meta connection, inbox/team roles, chatbot/forms/broadcasts, AI template drafting, approval-state sync and approved-template sending. Do not implement an unverified 100-message cutoff. |
| P2 | Growth integrations | Verify supported OAuth redirects, CRM, Google/Meta lead capture, custom forms and provider-specific unsupported states. |
| P2 | Operations | Configure background jobs, backups/restore, monitoring and public API status from measured checks. Review published API docs against deployed routes. |

## Corrections to older scope

- Customer owns carrier account and number; Call Vani does not sell numbers or approve number KYC.
- Admin manages platform voice/OAuth/payment credentials; Vobiz customer credentials remain workspace scoped.
- Keep user-facing terminology Customer, not Tenant.
- Payment and bank setup remains pending until actual configuration and successful reconciliation are observed.
- A passing synthetic test or HTTP page response is not a completed phone call, delivered email, successful payment or complete panel audit.

## Current call explanation

The fresh VPS workspace contains neither a carrier connection nor an assigned
number. Its starter agent is draft with calls disabled. These are confirmed
application blockers before a Vobiz dial request can be expected to work.
The Vobiz dashboard confirms the number exists and displays INR 25 balance.
API credential validity, outbound permissions and audio remain unverified.
