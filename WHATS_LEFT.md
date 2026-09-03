# Vaani — What's left

Status (2026-09-03). Tracks 0-3 of the AI-Calling-OS plan plus the master
blueprint's customer-side gaps have landed. This file records what genuinely
remains and **why** — including work that is blocked on something outside this
repository, and work deliberately deferred.

Legend: **[CODE]** engineering here · **[KEY]** an account or key you supply ·
**[BLOCKED]** cannot be built in this runtime · **[DECIDED]** deferred on purpose.

## What remains

### 1. [BLOCKED] Live media — the one thing everything else waits on

A bidirectional audio path cannot live in this worker. The generated config has
`durable_objects.bindings: []`, no queue consumers and no WebSocket anywhere;
only D1 and R2 are bound. A media socket needs a separate always-on service.

Everything around it is built and gated honestly:

| Surface | State |
|---|---|
| Inbound calls | `POST /api/webhooks/telephony/inbound` resolves the route, opens the call record, returns `mediaBridged: false`. Needs `INBOUND_WEBHOOK_SECRET` + a carrier. |
| Outbound calls | `POST /api/app/calls` returns 503 without `VOICE_STREAM_URL`. |
| Campaign dialling | The dialer runs every gate and records `telephony_unconfigured` instead of claiming a dial. |
| Agent Desk | Accept, reject, transfer-in and wrap-up work. **Mute, hold and conference** need the gateway. |
| Live monitoring | Transcript view and "Take over" work. **Listening to live audio** needs the gateway. |

### 2. [CODE][DECIDED] Localized dashboard (§15)

The AI speaks 13 languages; the portal UI is English only. This is a real
project — 25 customer sections plus the admin portal — and a half-translated
interface is worse than an English one. Worth doing as its own focused piece,
not squeezed in. Say the word and it goes next.

### 3. [CODE][DECIDED] Multi-currency (§14)

No tenant currency, FX source, price books or base-currency normalisation;
everything is INR. Deferred because there is no second currency in play yet —
building an FX layer now would be speculative. Needed before selling outside
India.

### 4. [CODE][DECIDED] Partner / white-label (Track 4, §2)

Needs org hierarchy, per-partner branding and domains, markup pricing,
commission accounting and a second billing rollup. It touches tenant isolation
and billing everywhere. Revisit once the core product has real usage.

### 5. [KEY] Things only you can supply

- **A male ElevenLabs voice id** (still outstanding) and a Punjabi voice id.
- Sarvam (Indian-language STT/TTS), OpenAI (for the Realtime path).
- A carrier: Exotel/Twilio/Plivo number + KYC + inbound webhook or SIP.
- Razorpay/Stripe live keys — connect them **per workspace** in the marketplace,
  not as platform env vars (see the ledger note below).
- Meta WhatsApp business + approved templates; Meta/Google Lead Ads OAuth.
- Google/GitHub/Microsoft OAuth apps (the admin panel now stores these).
- `CRON_SECRET` + a scheduler, and `INBOUND_WEBHOOK_SECRET` for inbound.
- Resend (or SMTP) so team invitations and alert emails actually leave.
- Private R2/S3 for recordings.

**Rotate the three keys pasted into chat** — treat them as exposed.

## Landed

**Track 0 — truth and safety.** RBAC holes closed and failing closed; admin
health panel reports measured values instead of literals; alerts fire on real
telemetry with auto-resolve and delivered channels; scheduler documented and
scripted; language settings honoured without resetting retention.

**Track 1 — call telemetry.** `call_turns`, `transcripts`, `summaries`,
`call_participants`, `recordings`; a `call.intelligence` job producing summary,
intent, sentiment, objections and a QA review sampled at `qa_sample_rate`; a
call-detail drawer; recordings return an honest 404 instead of a demo tone.

**Track 2 — queues and handoff.** `queues`, `queue_members`, `routing_rules`;
four routing strategies with capacity, priority and overflow; Agent Desk and
supervisor wallboard, polling because the runtime has no socket.

**Track 3 — org structure.** `branches`, `departments`, `teams`, `shifts`,
`agent_languages`, `number_routes`, `contacts`; shift-aware routing;
per-number routing; `max_numbers` and plan concurrency enforced.

**Integration marketplace (§13).** One catalog of 37 providers in 9 categories
driving both the API and the grid; live credential tests for the 13 that
publish a safe read-only endpoint; the rest stored and marked unverified;
disconnect; unrecognised stored connections surfaced.

**ElevenLabs webhooks.** `POST /api/webhooks/elevenlabs` verifies the HMAC
signature over `${timestamp}.${body}` in constant time, rejects replays outside
30 minutes, and is idempotent on the event id. A **voice removal notice** flags
every voice profile bound to that voice and emails the owner before the agent
goes silent; a **transcription completed** event attaches the transcript to a
call when the request carried `metadata.call_id`. Unsupported events are
recorded, not dropped.

**This pass.** Real analytics aggregates with per-language breakdown; report
runs with downloadable CSV; a campaign dialer that runs every gate; delivered
team invitations; a working "Take over"; sign-in providers beyond Google;
tenant create/suspend/reactivate with platform admin sub-roles; an inbound
entry point; and an AI co-pilot for human agents.

## Defects found and fixed while testing

These were not visible from reading the code — each needed the thing to be run:

- **Creating a campaign always failed.** The INSERT bound seven values to eight
  placeholders. `npm test` now audits all 442 prepared statements for that class.
- **The agent answered the previous question.** Playground history was ordered
  by a one-second-precision timestamp, so same-second turns came back scrambled.
- **Every tool-using turn could silently die.** A 220-token cap truncated the
  tool_use JSON, so the turn threw and fell back to canned simulator lines with
  a 12ms latency that looked like a fast reply.
- **`transfer_to_human` could never reach a skill queue** — the handler read
  `skill` and `language` that its schema never declared.
- **Escalation was keyword-matched**, so "किसी सीनियर से बात कराओ" matched nothing.
- **A platform Razorpay env key overrode the tenant's own merchant credential**,
  which would have collected that tenant's customer payments into the platform's
  account. WhatsApp had the same shape with a shared sender identity.
- **Suspension did nothing.** Nothing checked `organizations.status`, so a
  suspended workspace kept working.
- **Talk time was inflated.** Call duration was measured to the moment the idle
  sweeper ran, recording a 3-second chat as 2652 seconds.
- **A connected Resend key was never read** — stored as `resend`, looked up as
  `email_resend`.
- **Reconfiguring an integration returned an id that was never inserted.**
- `lib/job-queue.ts` and `lib/call-telemetry.ts` formed an import cycle.
