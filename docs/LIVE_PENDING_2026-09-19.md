# Call Vani live completion ledger — 19 September 2026

This ledger reconciles the conversation, WHATS_LEFT.md, PRODUCT_READINESS.md,
and the September 12 feature flow with production evidence. Historical claims
of local completion do not establish production activation.

## Verified this session

- VPS app and media systemd services: active; the current Vobiz media adapter deployment (`ba29757`) is live.
- App service passes `/etc/callvani/app.env` to Wrangler explicitly.
- Direct VPS customer password login: HTTP 200.
- Direct VPS database health: healthy.
- Google provider row now exists, visible but disabled.
- Siddharth workspace: customer-owned number is attached to the **Call Vani AI Inbound** Vobiz application. Customer-scoped Vobiz credentials remain encrypted; carrier routing and agent binding are still unverified.
- Owner test workspace has a Launch trial through 26 September; no payment was taken.
- The prior starter agent is superseded for the customer test workspace by **Aarohi · Sidharth Kumar Services** (currently `testing`, not Live).
- Vobiz console independently shows one attached number and INR 25 balance; provider call routing remains unverified.
- Removed old root A 172.66.3.26 in Hostinger. Authoritative DNS now returns only VPS 129.121.139.191; www aliases root. Resolver caches may lag.
- Let’s Encrypt TLS is live for both `callvani.com` and `www.callvani.com`. The certificate is installed in Nginx, redirects HTTP to HTTPS, expires 18 December 2026, and Certbot renewal is scheduled. Direct `--resolve` requests to the VPS returned the live healthy status response for both hostnames.
- The public secure media endpoint is configured as `wss://callvani.com/media-stream/`. Both the app and media-gateway services are active, and an authenticated WebSocket handshake reached the gateway successfully.
- Vobiz ownership verification now returns HTTP 200 on VPS after deployment e416f20. Root cause of 502: workerd rejects Request redirect mode `error`; changed to `manual`, rejecting 3xx without forwarding credentials. 106 assertions and TypeScript pass. Number is ownership-verified, routing_required, not active.
- Signed Vobiz inbound adapter deployed in 52d6234. It resolves only a uniquely active customer-owned Vobiz number, verifies the customer token signature before creating an idempotent call record, resolves an active route, then returns Vobiz stream XML. The Vobiz account now has a **Call Vani AI Inbound** application with this adapter as its POST answer URL, and the purchased number is attached to it. The production media health endpoint advertises `vobiz`, and the Vobiz mu-law, audio-playback and barge-in protocol tests pass. The next requirement is routing the number to the tested Call Vani agent and validating an actual call.
- Siddharth's customer agent is now **Aarohi · Sidharth Kumar Services**, in `testing` state with Hindi/Hinglish/English/Punjabi sales discovery, safety guardrails, lead/follow-up/appointment/human-handoff tools, and structured qualification fields. It is deliberately not Live until voice provider and media tests succeed.
- The complete production build now passes. Focused route/media verification also passes: carrier selection 7 assertions, inbound routing 20 assertions, call-quality readiness 30 checks, multilingual synthesis routing 22 assertions and media gateway 45 checks. These prove the application paths, not third-party credential validity or a completed phone call.

## Pending, in execution order

| Priority | Area | Remaining work / acceptance evidence |
|---|---|---|
| P0 | Domain and TLS | **Complete:** DNS cutover and HTTPS/WSS verification for root and www. |
| P0 | Google sign-in | Save existing OAuth client credentials encrypted, enable provider, confirm consent/test-user availability, test callback and session on live domain. |
| P0 | Account access | Verify customer and admin login through final HTTPS domain, role separation, logout and reset-password email delivery. |
| P0 | Vobiz | Customer credentials and ownership verified. Bind number to a ready agent and verify outbound permissions with an actual call. |
| P0 | Inbound adapter | Vobiz signed XML adapter and its Vobiz application are configured, and the purchased number is attached. Bind its active Call Vani number route to the tested agent, then place an inbound call and confirm audio/terminal callback evidence. |
| P0 | Voice | Connect available STT, reasoning and TTS credentials; test Hindi/English male/female samples; select measured quality and latency. No provider currently has verified production health. |
| P0 | Media/webhooks | HTTPS/WSS reachability and shared-secret handshake verified. Still verify a real Vobiz answer/status callback and bidirectional audio through the attached number. |
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

The VPS workspace contains the carrier connection and the number is attached
to the Vobiz application. Ownership is verified; routing checks are still
pending. Its customer agent is Aarohi, currently in `testing` rather than
Live. The deployed media gateway advertises the `vobiz` adapter and its
synthetic protocol tests pass, but Vobiz's exact live bidirectional stream
contract still needs an answered call before audio interoperability can be
claimed. These are confirmed blockers before a production dial request should
be attempted.

The Vobiz dashboard confirms the attached number and INR 25 balance. The
production inbound endpoint rejects an incomplete callback with the expected
HTTP 400 validation response, and the media health endpoint returns HTTP 200.
Local regression evidence on 19 September: Google callback 69 assertions,
password reset 11 assertions, Vobiz adapter 66 assertions and Vobiz webhooks
29 assertions. These are synthetic tests only; no real test call or email
delivery has completed.
