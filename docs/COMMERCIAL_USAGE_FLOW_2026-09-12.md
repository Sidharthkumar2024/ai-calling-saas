# Call Vani commercial usage flow

This is the agreed product model for calls, WhatsApp, SMS, email and AI usage.

## Onboarding default

The customer should do as little technical setup as possible.

1. Customer buys a plan.
2. Call Vani recommends a setup from business basics.
3. Default path is managed setup: number, AI agent, test call, WhatsApp guided connection.
4. Advanced path is bring-your-own-provider for carrier, SMS or email keys.

## Provider strategy

- Call carriers: keep flexible. Support managed Vobiz where useful, but do not force customers to create or connect Vobiz directly.
- Enterprise calls: allow Twilio, Plivo, Exotel or Vobiz credentials as advanced BYO providers.
- WhatsApp: use Meta Embedded Signup directly so the customer owns WABA and compliance.
- SMS: default can be managed later, but advanced BYO providers must include Twilio, Plivo, MSG91, Gupshup, Vobiz SMS and generic API/webhook.
- Email: support Resend, SendGrid, SES, Mailgun and SMTP.

## Billing model

Use one Call Vani wallet. Every billable action creates a traceable ledger entry.

1. Before a send/call/test starts, estimate credits from the customer usage rate card.
2. Hold credits from the wallet.
3. After the provider webhook or completion event arrives, finalize the actual usage.
4. If the provider rejects or fails before acceptance, release the hold.

The customer sees simple credits. Admin sees cost basis, provider cost, billed credits and margin.

## Customer rate card

The first backend version lives in `lib/customer-usage-pricing.ts`, is seeded
into the editable `customer_usage_rates` table, and is exposed through:

- `/api/app/billing`
- `/api/app/billing/rate-card`

Initial customer-facing categories:

- inbound call minute
- outbound call minute
- AI voice processing minute
- agent test call
- WhatsApp marketing template
- WhatsApp utility/authentication template
- WhatsApp service reply
- SMS message
- email send
- recording storage

## Wallet backend

Reusable wallet helpers live in `lib/usage-wallet.ts`:

- `holdUsageCredits`
- `finalizeUsageCredits`
- `releaseUsageHold`

These functions intentionally use the existing immutable `credit_ledger` rather than a separate mutable balance log.

## SMS backend

The first BYO SMS send endpoint is `/api/app/sms`.

Flow:

1. require a workspace user with campaign permission
2. validate phone number and message
3. hold `sms_message` credits
4. send through the saved `sms_gateway` integration
5. finalize when the provider accepts
6. release the hold for sandbox/no-provider or provider rejection

Segment-count reconciliation should be added when a connected provider returns
final segment counts in a delivery webhook.

## Admin control

Admin billing now has a customer usage rate-card editor. Operators can update:

- credits charged per unit
- active or retired status
- customer-facing note
- margin/internal note

Provider cost cards stay separate from customer billed credits, so Call Vani can
show simple credits to customers while still tracking internal margin.
