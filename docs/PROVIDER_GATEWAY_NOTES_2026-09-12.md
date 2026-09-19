# Provider Gateway Notes — 2026-09-12

This note records the provider surface added to admin and customer panels.
It is an implementation map, not proof that live credentials have been tested.

## Admin provider cards added

- Bolna AI: API key, base URL, default agent, webhook secret and status page.
- Cartesia: API key, voice ID, model and base URL for Sonic voice lanes.
- Vobiz: auth ID, token, base URL and webhook secret for numbers/calls.
- Generic SMS: provider, sender ID, base URL and delivery webhook secret.
- Payment gateways: Stripe, PayU, PhonePe, Paytm and Cashfree.

## User marketplace entries added

- Bolna AI voice calls.
- Cartesia voice.
- SMS gateway.
- PayU, PhonePe, Paytm and Cashfree payment connections.

## Verified documentation points

- Bolna quickstart uses `https://api.bolna.ai/user/me` for Bearer-key checks and `/call` for outbound calls.
- Bolna execution polling uses `/executions/{id}`. `completed` is the final state to wait for; `call-disconnected` can arrive before duration/cost/transcript are finalized.
- Bolna webhooks post execution payloads to a public endpoint, with statuses such as `scheduled`, `queued`, `in-progress`, `completed`, `no-answer`, `busy`, `failed`, `error` and `balance-low`.
- Bolna docs show post-call follow-up patterns for SMS and WhatsApp via webhook-triggered automations.
- Deepgram project/key APIs use `Authorization: Token ...`; the app already uses the projects endpoint as a read-only credential check.

## Still not complete

- No live Bolna, Vobiz, Cartesia, SMS or payment gateway credential was tested.
- Payment gateway settlement/webhook reconciliation still needs real provider adapters.
- SMS send API and wallet debit are implemented for a BYO `sms_gateway`
  integration. Final delivery receipt reconciliation, segment-count settlement
  and live provider acceptance still need the selected production gateway.
- Bolna call creation and execution settlement are mapped for future work; they are not yet wired into the live dialer.
