# Call Vani latest feature flow — 12 September 2026

This file is the working source of truth for the product flow discussed on
12 September 2026. It combines the customer experience, backend billing model,
provider strategy and the remaining completion checklist.

## Product decision summary

Call Vani should feel managed and simple by default. The customer should not be
forced to understand telecom providers, API keys, Meta approval details or
wallet internals before they can launch.

The platform should still support advanced bring-your-own-provider setup for
larger customers.

### Final default model

1. Customer buys a plan.
2. Customer answers a short AI Business Manager setup interview.
3. Call Vani recommends and prepares the workspace.
4. Customer gets a managed launch path for number, AI agent, WhatsApp, inbox,
   templates, forms and testing.
5. Advanced users can connect their own carriers, SMS providers and email
   providers.
6. All usage is charged through one Call Vani wallet with a clear ledger.

## Onboarding flow

### Step 1 — Business basics

Ask only what is needed to create the first working setup:

- company name
- website
- industry
- target customer
- main goal: leads, support, sales calls, WhatsApp automation, appointments or
  payment collection
- competitors or reference websites, optional

### Step 2 — AI Business Manager recommendation

The AI Business Manager should recommend:

- best starter use case
- first AI agent
- first WhatsApp template set
- first chatbot/flow
- lead form fields
- first test call script
- CRM fields
- follow-up rules

### Step 3 — Launch checklist

Show a launch checklist in the dashboard:

- plan active
- wallet funded
- number active or carrier connected
- WhatsApp connected
- first AI agent ready
- first template drafted/submitted
- inbox ready
- test call complete
- test WhatsApp message complete
- billing rate card reviewed

Every row should have a clear action button and a `Test now` option where
possible.

## Provider strategy

### Calls

Use a flexible carrier model.

Default:

- managed Call Vani number, powered by a backend carrier partner such as Vobiz

Advanced:

- customer connects Twilio, Plivo, Exotel or Vobiz
- customer-owned carrier credentials remain tenant-scoped

Reason:

- small customers get low-friction launch
- enterprise customers keep provider ownership and procurement control
- Call Vani avoids lock-in to one telecom provider

### Vobiz role

Vobiz should be treated as a carrier and number infrastructure partner, not as
the customer-facing product.

Vobiz can provide:

- numbers
- inbound calling
- outbound calling
- call status webhooks
- SMS/voice OTP receiving for verification
- carrier routing
- optional WhatsApp-capable number inventory, when eligible

Call Vani provides:

- AI agent layer
- conversation workflow
- wallet billing
- WhatsApp inbox
- templates and bot builder
- CRM/payment/lead automation
- analytics and admin controls

### WhatsApp

Use direct Meta Embedded Signup for WhatsApp so the customer owns the WABA and
the compliance relationship.

Supported cases:

- customer connects an existing WhatsApp Business Platform number
- customer verifies a managed carrier number, if that number can receive Meta
  OTP by SMS or voice
- customer uses a separate WhatsApp number from their call number

Important rule:

- do not hide Meta/WABA ownership from the customer
- do simplify the UI so it feels like a two-minute guided setup

### SMS

Default:

- Call Vani can later offer managed SMS for small customers

Advanced:

- Twilio
- Plivo
- MSG91
- Gupshup
- Vobiz SMS
- generic SMS API/webhook

### Email

Default:

- Call Vani can later offer managed email for simple transactional messages

Advanced:

- Resend
- SendGrid
- Amazon SES
- Mailgun
- SMTP

## WhatsApp Command Center

Replace basic WhatsApp pages with a full WhatsApp Command Center.

### Main tabs

1. **Inbox**
   - customer chats
   - AI reply suggestions
   - human handoff
   - labels
   - team assignment
   - 24-hour service-window status
   - conversation history

2. **Templates**
   - marketing templates
   - utility templates
   - authentication templates
   - language variants
   - variables
   - media/header/footer/buttons
   - Meta approval status
   - rejection reason
   - live mobile preview
   - estimated cost before send

3. **Bot Builder**
   - drag-and-drop canvas
   - trigger node
   - message node
   - question node
   - buttons/list node
   - collect name/phone/email node
   - API/webhook node
   - payment link node
   - CRM update node
   - team handoff node
   - agent handoff node
   - delay node
   - condition node
   - end node

4. **Broadcasts**
   - audience selection
   - template selection
   - variable mapping
   - opt-in check
   - schedule
   - cost estimate
   - wallet balance check
   - delivery/read/failure report

### WhatsApp UI layout

Use a professional builder layout:

- left panel: blocks and assets
- center: visual flow canvas
- right panel: live WhatsApp phone preview
- top bar: draft, submitted, approved, rejected, live
- bottom bar: cost estimate, warnings and publish controls

## WhatsApp policy and billing

WhatsApp billing should be category-aware.

Supported customer-facing categories:

- marketing template
- utility template
- authentication template
- service reply inside the active customer-service window

Wallet behavior:

1. estimate credits before sending
2. hold credits
3. send through Meta/provider
4. finalize debit on provider webhook
5. release hold if the provider rejects before acceptance

The customer sees simple credits. Admin sees:

- Meta category
- country
- provider cost
- Call Vani billed credits
- gross margin
- failure/refund status

## Unified wallet and rate card

All billable usage must go through one Call Vani wallet.

### Billable line items

- inbound call minute
- outbound call minute
- AI voice minute
- test call
- WhatsApp marketing template
- WhatsApp utility/authentication template
- WhatsApp service reply
- SMS message
- email send
- transcription
- TTS
- LLM usage
- recording storage
- extra team seat

### Ledger states

Each usage event should support:

- estimate
- hold
- final debit
- refund/release
- adjustment
- reconciliation required

### Existing backend foundation

Already added in this pass:

- `lib/customer-usage-pricing.ts`
- `lib/usage-wallet.ts`
- `/api/app/billing/rate-card`
- `/api/app/billing` includes `usageRateCard`
- `customer_usage_rates` table seeded from the default rate card
- admin platform API can update customer usage credit rates
- `/api/app/sms` for BYO SMS gateway sends with wallet hold/finalize/release

These are the common backend primitives. WhatsApp inbox sends and commerce
payment-link delivery now call them. The first SMS send path also calls them;
delivery webhook reconciliation and carrier minute settlement continue as the
next backend tranche.

## Pricing pages

### Public pricing page

Show simple plans:

- Starter
- Growth
- Business
- Enterprise

Each plan should explain:

- included credits
- AI agents
- team seats
- WhatsApp inbox
- call minutes or credit pool
- chatbot/bot builder access
- lead forms
- integrations
- support level

### In-app rate card

Show exact credit usage:

- per inbound call minute
- per outbound call minute
- per AI voice minute
- per test call
- per WhatsApp template category
- per SMS
- per email
- per storage unit
- overage rules

Customer copy should stay simple. Admin should see margin math.

## Admin panel requirements

Admin must control:

- plans
- credit packages
- customer usage rate card
- provider cost rate cards
- carrier providers
- SMS providers
- email providers
- payment gateways
- WhatsApp platform credentials
- Vobiz/Twilio/Plivo/Exotel settings
- Deepgram/Sarvam STT
- Cartesia/ElevenLabs TTS
- OpenAI/Anthropic LLM routing
- markup and margin
- wallet reconciliation
- failed holds
- webhook health
- provider status

No production provider should require editing environment variables after the
admin UI exists for it.

## User panel requirements

User panel should include:

- setup checklist
- AI Business Manager
- numbers/carriers
- WhatsApp Command Center
- chatbot builder
- template builder
- broadcasts
- inbox
- wallet and ledger
- rate card
- invoices
- payment methods
- usage analytics
- team and roles
- integrations
- API keys
- test console
- status page for provider connections

## Backend completion checklist

### P0 — current production gates

Done locally:

- `holdUsageCredits`, `finalizeUsageCredits` and `releaseUsageHold` are wired
  into WhatsApp send paths for templates, forms and service replies.
- The first BYO SMS send route reserves/finalizes/releases credits.
- Email/WhatsApp payment-link delivery reserves/finalizes/releases credits,
  including scheduled jobs.
- Admin can edit customer usage rates and see margin/cost notes.
- Customer billing exposes the in-app rate card.

Still open before paid production:

- Delivery/read/failure webhook reconciliation for WhatsApp final states.
- SMS delivery receipt reconciliation and final segment-count settlement from a
  selected live SMS provider.
- Bounce/complaint reconciliation for production email delivery.
- Call start/end settlement across every inbound and outbound carrier route.
- Reconciliation queue/UI for uncertain provider acceptance.
- Meta Embedded Signup end-to-end.
- WhatsApp template approval lifecycle end-to-end.
- WhatsApp bot builder publish/runtime execution.
- Broadcast wallet estimate before send.
- Provider health checks for Meta, Vobiz, Twilio/Plivo/Exotel, SMS, email,
  Deepgram, Cartesia and payment gateways.

### P1 — product polish

Done locally:

- WhatsApp Command Center strip across inbox operations.
- WhatsApp Forms/Bot builder block palette and live phone preview.
- Animated wallet credit feedback.
- AI Business Manager generated setup preview.

Still open:

- Launch checklist progress animations beyond the current setup preview.
- Add professional empty states for every first-use screen.
- Finish mobile-responsive fixes for remaining integration strips and large text
  sections.
- Finish real brand icons for Google, Meta, Razorpay, HubSpot, WhatsApp and payment
  providers.

### P2 — enterprise

- BYO carrier contract controls.
- BYO SMS/email controls.
- workspace-level provider routing rules.
- approval-before-send policies.
- SSO/SCIM.
- audit export.
- custom data retention.
- white-label pricing.

## Product principles

- Minimize customer setup.
- Keep advanced configuration available but hidden by default.
- One wallet, one ledger, every charge traceable.
- Never claim provider success before webhook/real evidence.
- Separate provider cost from customer billed credits.
- Keep WhatsApp compliance customer-owned through Meta.
- Make every feature testable from the UI.
- Make admin able to manage pricing, margin and provider health without code
  changes.

## Current implementation status

Completed in the latest backend pass:

- customer usage rate-card constants
- customer usage rate-card DB table and seed data
- admin API action for customer usage rate updates
- admin billing UI for customer usage rate/card status and margin notes
- SMS send API route with BYO SMS gateway, insufficient-balance handling,
  provider rejection release and sandbox release
- AI Business Manager launch setup preview and first-use launch checklist
- WhatsApp Command Center strip across inbox operations
- WhatsApp Forms builder block palette and live phone preview
- billing API exposes usage rate card
- dedicated rate-card API
- reusable wallet hold/finalize/release helpers
- customer billing screen shows the usage rate card
- WhatsApp inbox sends reserve/finalize/release credits for templates, forms
  and service replies
- commerce payment-link deliveries reserve/finalize/release credits for
  WhatsApp and email sends, including scheduled jobs
- commercial flow documentation
- this latest feature flow document

Still not fully wired:

- Meta delivery/read/failure webhooks are not yet reconciling final WhatsApp
  delivery states beyond provider acceptance
- SMS delivery receipts are not yet settling final segment counts from a live
  provider webhook, although the first BYO SMS send/debit route exists
- real carrier minute debit through the new generic helper is not yet wired for
  every inbound/outbound carrier path
- WhatsApp broadcast pre-send wallet estimation and campaign scheduling remain
  unfinished
- WhatsApp bot builder publish/runtime execution still needs the production
  graph-to-runtime bridge
- Meta Embedded Signup production flow

Verification from the backend pass:

- TypeScript passed
- product regression checks passed
- scheduled payment checks passed
- isolated usage wallet checks passed
- production build passed
