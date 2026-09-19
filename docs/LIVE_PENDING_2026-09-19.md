# Call Vani live completion ledger — 19 September 2026

This ledger reconciles the conversation, WHATS_LEFT.md, PRODUCT_READINESS.md,
and the September 12 feature flow with production evidence. Historical claims
of local completion do not establish production activation.

## Verified this session

- Production is now on `e5a00d8`; `callvani-app` and `callvani-media` are both active. The public status endpoint responds over HTTPS.
- Hostinger SMTP (`noreply@callvani.com`, TLS port 465) passed live transport verification. A real admin reset request delivered an unread **Reset your Call Vani password** email to the requested Gmail inbox. The browser no longer exposes an HTML response as an `Unexpected token '<'` JSON error.
- Cartesia, ElevenLabs and Sarvam production credentials are encrypted in the platform provider vault. Their secret values are not stored in repository files or printed by readiness checks.
- Aarohi is active on the customer-scoped Vobiz route. An authorised outbound test was accepted by Vobiz, both signed status callbacks returned HTTP 200 after the reverse-proxy signature fix (`a173a5a`), and the call reached terminal `completed` state with five recorded seconds. This proves carrier submission and callback handling, not an answered two-way AI conversation.
- VPS app and media systemd services: active; the current Vobiz media adapter deployment (`ba29757`) is live.
- App service passes `/etc/callvani/app.env` to Wrangler explicitly.
- Direct VPS customer password login: HTTP 200.
- Direct VPS database health: healthy.
- Google provider row now exists, visible but disabled.
- Siddharth workspace: customer-owned number is attached to the **Call Vani AI Inbound** Vobiz application. Customer-scoped Vobiz credentials remain encrypted and its active route is bound to Aarohi.
- Owner test workspace has a Launch trial through 26 September; no payment was taken.
- The prior starter agent is superseded for the customer test workspace by active **Aarohi · Sidharth Kumar Services**.
- Vobiz console independently shows one attached number and INR 25 balance; outbound provider acceptance and terminal callbacks are verified.
- Removed old root A 172.66.3.26 in Hostinger. Authoritative DNS now returns only VPS 129.121.139.191; www aliases root. Resolver caches may lag.
- Let’s Encrypt TLS is live for both `callvani.com` and `www.callvani.com`. The certificate is installed in Nginx, redirects HTTP to HTTPS, expires 18 December 2026, and Certbot renewal is scheduled. Direct `--resolve` requests to the VPS returned the live healthy status response for both hostnames.
- The public secure media endpoint is configured as `wss://callvani.com/media-stream/`. Both the app and media-gateway services are active, and an authenticated WebSocket handshake reached the gateway successfully.
- Vobiz ownership verification returns HTTP 200 on VPS after deployment e416f20. Root cause of the earlier 502 was workerd rejecting Request redirect mode `error`; it now uses `manual` and rejects 3xx without forwarding credentials.
- Signed Vobiz inbound adapter deployed in 52d6234. It resolves only a uniquely active customer-owned Vobiz number, verifies the customer token signature before creating an idempotent call record, resolves an active route, then returns Vobiz stream XML. The Vobiz account has a **Call Vani AI Inbound** application with this adapter as its POST answer URL, and the purchased number is attached to it. The production media health endpoint advertises `vobiz`, and the Vobiz mu-law, audio-playback and barge-in protocol tests pass.
- Siddharth's customer agent is active as **Aarohi · Sidharth Kumar Services**, with Hindi/Hinglish/English/Punjabi sales discovery, safety guardrails, lead/follow-up/appointment/human-handoff tools, and structured qualification fields.
- The complete production build now passes. Focused route/media verification also passes: carrier selection 7 assertions, inbound routing 20 assertions, call-quality readiness 30 checks, multilingual synthesis routing 22 assertions and media gateway 45 checks. These prove the application paths, not third-party credential validity or a completed phone call.

## Pending, in execution order

| Priority | Area | Remaining work / acceptance evidence |
|---|---|---|
| P0 | Domain and TLS | **Complete:** DNS cutover and HTTPS/WSS verification for root and www. |
| P0 | Google sign-in | Live Google authorization opens with the Call Vani callback. Permanently retire the previously exposed client secrets, save one fresh encrypted secret, then finish a real callback/session test. |
| P0 | Account access | Reset email delivery is verified. The account owner must open the one-time link and submit the new password; then verify customer/admin role separation and logout on the final domain. |
| P0 | Vobiz | Customer credentials, number, active Aarohi route, outbound permission and terminal status callbacks are verified. Still verify an answered call and inbound routing. |
| P0 | Inbound adapter | Vobiz signed XML adapter and its Vobiz application are configured, and the purchased number is attached. Bind its active Call Vani number route to the tested agent, then place an inbound call and confirm audio/terminal callback evidence. |
| P0 | Voice | Cartesia, ElevenLabs and Sarvam credentials are encrypted. Deepgram still needs a working console session/new key. Measure Hindi/English/Punjabi samples and latency before choosing the production default. |
| P0 | Media/webhooks | HTTPS/WSS and real signed Vobiz status callbacks are verified. The test was not answered, so the answer XML, media socket and bidirectional audio still need live evidence. |
| P0 | Test call | Carrier test to the authorised destination ending `0067` completed with two HTTP 200 status callbacks and five recorded seconds. Repeat while answered to verify Aarohi audio, transcription, response and barge-in. |
| P1 | GitHub private repo | Add read-only VPS deploy key, switch origin to SSH, verify fetch after privatization. Current public-HTTPS updater is not sufficient for private repo. |
| P1 | Email | SMTP encrypted storage, TLS/auth and real forgot-password delivery are complete. Consuming the one-time reset link and submitting the new password remains a user-controlled step. |
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
to the Vobiz application. Ownership, the active Aarohi route, outbound
submission and signed terminal callbacks are verified. The reverse-proxy
signature mismatch that returned HTTP 401 is fixed: the app now validates the
exact public callback URL from the trusted `PUBLIC_BASE_URL`, while retaining
workspace-token isolation. The authorised call ended after five recorded
seconds without answer/media evidence, so Vobiz's live bidirectional stream
contract still needs an answered call before audio interoperability can be
claimed.

The Vobiz dashboard confirms the attached number and INR 25 balance. The
production inbound endpoint rejects an incomplete callback with the expected
HTTP 400 validation response, and the media health endpoint returns HTTP 200.
Local regression evidence on 19 September: Google callback 69 assertions,
password reset 11 assertions, Vobiz core 68 assertions and Vobiz webhooks 30
assertions. In addition to those synthetic checks, a real reset email was
delivered and a real Vobiz call reached terminal `completed`; neither proves
two-way AI audio because the test call was not answered.
