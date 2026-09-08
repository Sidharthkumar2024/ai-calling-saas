# Call Vani product audit — 8 September 2026

## Latest revision: branding, responsive UI, API contract and billing safety

This revision supersedes the earlier pricing proposal below. **The complete backlog is not finished.** P0/P1 items remain real implementation work, not all external-credential blockers.

| Request | Current status | Evidence / remaining limit |
| --- | --- | --- |
| Call Vani spelling | Updated visible landing/auth/workspace strings and phone artwork | Internal database IDs, API key prefixes and webhook headers retain backward-compatible names |
| Circular, moving integrations | Complete in local preview | Square aspect-ratio geometry, clockwise orbit and inverse logo rotation; pause/resume and reduced-motion support |
| Mobile clipping | Fixed in affected sections | 320px and 390px page widths have no horizontal page overflow; source grid uses two columns; 1440px desktop circle also checked |
| API docs | Rebuilt at `/docs` | Actual v1 endpoints, field shapes/scopes/errors, billing units, webhook verifier, visible copy controls and `/docs/openapi.json`; undocumented or incomplete functionality is not invented |
| New plan/credit catalog | Active for new local checkouts | Launch ₹2,999, Growth ₹9,999, Scale ₹24,999 monthly; ₹1.90/credit. No recurring included voice credits. Existing subscriptions and wallets remain unchanged |
| Profit / provider costs | Planning model, not measured net profit | See `COMMERCIAL_REVIEW_2026-09-08.md`; admin view also exposes assumptions. INR and USD supplier rates are no longer compared as if they were the same currency |
| Realtime accounting race | Atomic reserve/refund implemented | Unique request key owns one reservation before provider creation. Definite rejection refunds once; uncertain acceptance retains credit reservation for reconciliation |
| Exotel duplicate settlement | Atomic settlement implemented | One ledger ID per call; wallet relative update and call cost commit together. Completed-call overage is retained as negative balance, not silently erased |
| Legacy paid checkout | Preserved during catalog change | Verified checkout created before retirement can still fulfill; new checkout remains active-plan-only. Disabled plans still rejected |
| Subscription badge | Corrected | Subscription status and catalog status are selected separately, so a retired catalog entry no longer makes an active customer subscription display as “legacy” |

Current verification: release-safety transactional SQLite tests pass; landing checks 327; product checks 61; UI/auth/billing checks 173 including 28 fulfillment assertions; TypeScript and lint pass. Full `npm test` passed in this revision. Browser checked circular geometry/motion/pause-resume, post-film branded phone, mobile strip, docs copy and no horizontal page overflow. OpenAPI returned HTTP 200 with valid JSON. No paid calls, real messages, real purchases, external OAuth consent or production deployment were performed.

The new accounting table is delivered in migration `0009_naive_lionheart.sql` and applied to the local development database. Production must apply migrations through its deployment workflow before serving the new route. Helper-level concurrency tests are not end-to-end provider-failure classification or production load tests.

The authenticated local billing screen was additionally checked: all three new plans and packs display correctly, the prior Growth subscription remains active, and the wallet balance was unchanged. No checkout/top-up button was submitted. Catalog publication is tested concurrently and repeatedly against isolated SQLite, including preservation of old terms and subscription status.

## Outcome and limits

This local implementation pass improves business onboarding, WhatsApp reply safety, lead forms, admin-managed credentials, Google authentication and pricing visibility. It is **not a production sign-off or a claim that every button and integration works end to end**.

Customer and admin login succeeded on localhost. Navigation was checked across 37 customer sections and 11 admin sections. The automated suites, type-check, lint and production build pass. Real calls, real WhatsApp messages, payment collection, external OAuth consent, provider credential changes and production deployment were not performed in this pass.

Earlier work did not change the catalog. The latest revision adds a versioned catalog for **new** purchases and retires the seeded old options from new checkout selection; existing subscription contracts and balances are preserved. Supplier costs and minute-profit projections remain planning references, not measured invoices.

## Implemented in this pass

### AI Business Manager

- A first-use, three-step business brief replaces an unexplained empty manager for users who can manage the workspace.
- The interview covers company/site, product and customers, competitors and the desired business outcome. Company information is required in the new flow; website/competitor information may be omitted.
- Each step saves and merges answers, validates earlier required answers and resumes the first incomplete step. Unknown fields, malformed requests and excessive answer lengths are rejected.
- The customer can reopen the brief. Read-only roles do not get trapped in an onboarding form they cannot save.
- These answers inform manager recommendations; they do not silently rewrite every agent prompt, start advertising, place calls or send messages.

### WhatsApp inbox and sending

- Search, refresh, visible-tab polling, cancellation on unmount and clearer connection/empty states.
- The actual latest inbound message controls the rolling 24-hour reply window, independently of the displayed history limit. Future/invalid timestamps fail closed.
- Free-text replies require a verified tenant connection and an eligible service window. Suppressed/do-not-contact recipients are blocked at the common text-send path, including digits-only and +E.164 representations.
- API validation rejects invalid numbers, malformed bodies and oversized replies. Provider errors are surfaced; unconnected/sandbox attempts are not written as successful outbound inbox messages.
- The inbox describes provider acceptance honestly; acceptance is not delivery confirmation.
- Webhook routing uses the exact connected phone-number asset. Duplicate tenant claims fail closed. Encrypted structured credentials are decoded correctly.
- A global WhatsApp sender cannot implicitly be used by every tenant. Legacy ENV fallback now requires an explicitly matching default organization.

### Website lead forms

- Custom text, phone, email and numeric fields; field labels; optional/required settings; add/remove controls. Canonical name and phone fields remain required.
- CTA text, headline, description, accent/background colors, HTTPS logo, popup placement, trigger, delay, animation and frequency controls.
- Preview reflects custom fields and readable color contrast. It supports close/reopen and replay. Preview submission is explicitly disabled; it is not a real lead submission.
- Accessible names for placement/preview controls and a visible clipboard failure message.
- Server-side field validation and bounded request/body sizes; custom answers persist in the capture event and readable lead notes.
- Public embed uses escaped content and shadow DOM; supports multiple forms on one page, exit intent, reduced motion and per-form show/hide APIs.
- Page attribution strips URL query/hash to reduce accidental collection of URL secrets.
- Publishing requires an allowed origin. An active form's save button says **Save live changes** because saving it currently updates the live embed; it is not a separate draft snapshot.

### Admin credentials, authentication and voice providers

- Admin configuration cards for Deepgram, the Meta platform WhatsApp app and Resend, plus ElevenLabs webhook/STT settings.
- New secret-shaped fields are encrypted alongside API keys, excluded from public provider configuration and never returned to fill the form. Blank fields preserve existing secrets; oversized secrets are rejected instead of truncated.
- Named secret fields are excluded from new audit payloads. Successful saves clear secret inputs in client state.
- Runtime adapters consume tenant credentials first, then admin-managed values, then permitted legacy ENV fallback. Disabled providers are respected in the touched paths, including streaming reasoning/realtime readiness.
- Structured webhook-only bundles are not mislabeled as usable speech/model API keys. Readiness means configured, not a successful live connection.
- ElevenLabs voice IDs follow the selected tenant credential rather than accidentally using a different account's admin voice ID.
- Deepgram buffered speech-to-text adapter with language/model configuration, timeout handling and measured duration in minutes for usage records. This is **not** a completed streaming WebSocket telephony integration or a measured latency improvement.
- Meta/ElevenLabs webhook verification and Resend delivery can consume encrypted admin settings.
- Google OAuth consumes a coherent admin-saved client ID/secret/redirect tuple. Partial/corrupt tuples fail closed rather than mixing unrelated ENV and admin values.
- Google linking retains verified-email, account status, portal, state/PKCE and MFA safeguards. Google remains disabled unless configured/enabled. Unsupported GitHub/Microsoft login cannot be enabled as if callbacks exist.
- Tenant Razorpay merchant fallback is scoped to an explicit default organization rather than implicitly collecting into the platform merchant account.

## What was actually tested

| Level | Coverage | What this does not prove |
| --- | --- | --- |
| Browser | Real local customer/admin sign-in; admin logout; Google disabled state; 37 customer and 11 admin section loads; no page-level errors/horizontal overflow in those navigation checks | Every nested button, mutation, permission combination or production integration |
| Browser interaction | Business brief validation/cancel; adding/renaming/removing a custom field; preview close/replay; cost-reference expansion | A new production tenant lifecycle, published third-party website or paid purchase |
| Product regression suite | 61 checks, including actual inbox route and commerce-module execution with isolated SQLite and synthetic providers; field validation, secret policy, onboarding, widget JavaScript and Deepgram responses | Real Meta acceptance/delivery, audio quality or carrier latency |
| UI/auth/billing safety suite | 169 checks: credit feedback 14, call feedback 9, notifications 42, billing fulfillment 24, password reset 11, Google callback 69 | External identity-provider consent or delivery of a real reset email |
| Existing full suite | `npm test` passes; includes call/media-gateway, tenant/domain logic, signatures, workflows, money, billing, integrations and action/guard checks | Complete end-to-end operation of the deployment |
| Static inventory | 775 SQL statements checked, 37 dynamic statements skipped, zero bind mismatches; 129 tables checked; 116 UI action names recognized; 69 write routes checked with zero unguarded findings | Dynamic SQL correctness, complete authorization or absence of all vulnerabilities |
| Build quality | TypeScript, lint, diff whitespace check and production build pass | Load capacity or production security certification |

The static inventory also notes an action-shaped `create_workflow` name with no matching screen sender. The build warns about client chunks above 500 KB and some vinext route classification limitations. These are not build failures, but bundle splitting remains useful.

## Commercial model

The earlier pricing proposal has been replaced by the versioned local catalog described above. See [plans, supplier costs and contribution scenarios](COMMERCIAL_REVIEW_2026-09-08.md) for current figures, primary-source references, WhatsApp eligibility, preserved legacy contracts and production-release gates.

The standard ₹19/minute planning target is not a universal live tariff: realtime remains a session-based reservation, text is per turn and Exotel uses started-minute settlement. Do not advertise unlimited usage or guaranteed net profit.

## Pending — implementation and production gates

### P0: before real paid customer use

1. **Finish unified metering.** Realtime now reserves atomically before provider creation with `realtime_session_v1` (10 credits/session), safe definite-rejection refunds and no automatic paid fallback on uncertain acceptance. Exotel completed calls settle atomically at 10 credits/started minute. Still needed: trusted realtime duration/end settlement, server-enforced duration/concurrency limits, uncertainty reconciliation UI/job, route/provider acceptance tests, and reservation/idempotency for text playground (still provider-before-conditional-debit), dialer and voice widget paths. Client uncertainty protection is in-memory and does not survive reload; do not treat it as durable reconciliation. Supplier usage-write failure retains an accepted session, but actual invoice reconciliation remains unimplemented. Stripe recurring invoice lifecycle (not only checkout success), tax/payment-total reconciliation and entitlement enforcement also require completion before paid production launch.
2. **Complete Meta Embedded Signup.** The new admin credential fields alone do not connect a customer's WABA. Implement the approved platform app flow, tenant-scoped encrypted tokens/assets, granular permissions, token lifecycle, webhook subscriptions, disconnect/revoke and duplicate-asset prevention. Real app review, business verification and customer consent are required. [Meta Embedded Signup reference](https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup).
3. **Live connector acceptance matrix.** Test authorized sandbox/live assets for inbound/outbound calls, actual recordings, Google/Meta lead ingestion, WhatsApp delivery, payment webhooks and refunds. Configured credentials are not proof of connectivity. Do not put “all integrations connected” in sales material.
4. **Storage/recording security.** R2/S3 private activation, signed access, retention/deletion jobs, upload quarantine and malware scanner must be configured and exercised end to end. Existing code/tests are not a verified live deployment.
5. **Credentials/bootstrap.** Audit/migrate old plaintext secret-shaped config and historical audit entries, rotate potentially exposed credentials and remove obsolete ENV fallbacks only after a verified transition. The root encryption key, database binding and media-gateway deployment still need secure infrastructure bootstrap; putting that root key inside the database it encrypts is not an alternative.
6. **Authentication production readiness.** Confirm real email delivery/verification, recovery, MFA enrollment, admin account provisioning and session protection on the intended HTTPS domain. Use local demo credentials only locally and rotate them before deployment.

### P1: requested features still needing implementation

- WhatsApp chatbot drag/drop graph editor, versioned publish/rollback and runtime execution. Existing voice/general workflow builders are not a completed WhatsApp chatbot builder.
- WhatsApp Flows/form authoring, publish state, encrypted dynamic-data endpoint and response mapping. [WhatsApp Flows](https://whatsappbusiness.com/products/whatsapp-flows/), [official endpoint example](https://github.com/WhatsApp/WhatsApp-Flows-Tools/tree/main/examples/endpoint/nodejs/basic).
- Template creation/approval/category lifecycle, variables/media validation, campaign scheduling, opt-in evidence, delivery/read/failure receipts, inbox assignment and cursor pagination. Current inbox displays a bounded recent history.
- Tenant-scoped WhatsApp agent configuration and server-enforced feature/role entitlements; redaction, approved tool/action allowlists, link/domain policy, prompt-injection resistance, moderation, approval-before-send and human takeover. Do not enable autonomous outgoing messages merely because an LLM can draft text.
- Payment gateway onboarding and settlement across the requested providers. Razorpay/Stripe foundations do not mean PayU, PhonePe, Paytm, Cashfree and manual-transfer reconciliation are all complete. Review tenant-specific webhook-secret selection, particularly remaining ENV-first Razorpay paths.
- Streaming Deepgram/media-gateway integration, voice catalog/language compatibility, provider failover and actual end-to-end p50/p95 latency measurement. ElevenLabs webhook support alone does not reduce conversational latency.
- Business Manager: a richer industry-specific interview, approved business playbook generation, reviewed recommendation-to-action handoff and measured outcomes. The new brief is the starting point, not an autonomous growth department.
- Lead forms: independent draft/published snapshots, additional field types/reordering/conditional questions, explicit consent evidence and true inline placement if required. Inline is deliberately not offered by this popup editor.
- Full admin-provider lifecycle for every newly added adapter, all runtime configuration paths, quotas, health verification and secret rotation UI. Not every remaining ENV value is admin-managed.
- Large-scale load/failover/backups, storage lifecycle/scanning, legal/compliance review, SSO/SCIM, mobile apps and white-label deployment remain separate acceptance work. No 10-million-user or zero-data-leak claim has been established.

For WhatsApp AI, scope the assistant to the tenant's actual business and have the platform use case reviewed against current WhatsApp Business Solution Terms; a general-purpose AI product and secondary model-training use raise additional restrictions. This is a product-compliance gate, not legal approval. [WhatsApp Business Solution Terms](https://www.whatsapp.com/legal/business-solution-terms).

## Re-run locally

```sh
npm run test:product
npm run test:release-safety
npm run test:ui-safety
npm test
npx tsc --noEmit --pretty false
npm run lint
npm run build
git diff --check
```

The new product/provider/auth harnesses use isolated SQLite and synthetic provider traffic. Do not substitute real customer phone numbers or paid provider keys in these tests. The local dev server remains on port 3000; this pass did not deploy or push. It changed only the local new-purchase catalog, not existing customer subscriptions/balances or deployed live billing.
