# Vaani — What's left

Status (2026-09-03). Tracks 0-3 of the AI-Calling-OS plan plus the master
blueprint's customer-side gaps have landed. This file records what genuinely
remains and **why** — including work that is blocked on something outside this
repository, and work deliberately deferred.

Legend: **[CODE]** engineering here · **[KEY]** an account or key you supply ·
**[BLOCKED]** cannot be built in this runtime · **[DECIDED]** deferred on purpose.

## What remains

### 0. Device/dialer extension — what is left

Built: audience import, device selection, microphone and speaker tests,
connection measurement, the readiness gate, support codes, the browser dialer
with mute and hold, conference rooms, and **supervisor listen / whisper / join**.
None of that needs a carrier.

Left, and each for a concrete reason:

- **[KEY] Transfer to a human on a *customer* call.** Bridging works — a second
  browser leg joins the room and the AI steps back — but a real customer is
  only on the line through a carrier. Agent-to-agent and supervisor bridging
  work today.
- **[KEY] Power and preview dialers (§20).** The queue logic exists in the
  campaign dialer; placing the outbound call needs a carrier.
- **[KEY] DTMF keypad (§12).** Only meaningful on a carrier leg.
- **[KEY] True per-call packet loss.** Loss is a property of the network a
  call crossed. The dialer now measures its own socket for real — frames each
  way, pacing, dropouts, round trip — and the WebRTC probe reports the codec,
  bitrate and whether media can leave the network. What still needs a carrier
  is loss on a *customer's* leg, because there is no such leg without one.

### 1. [KEY] Live media — built, waiting on a carrier

`services/media-gateway` now holds the audio leg. It terminates the carrier
WebSocket (Twilio Media Streams, Exotel voicebot), converts G.711, detects turn
boundaries and barge-in, and streams the reply back in 20 ms frames. Vaani keeps
speech-to-text, reasoning, tools, synthesis and telemetry behind
`POST /api/internal/voice-turn`, so the gateway holds one shared secret and no
customer credentials.

Verified end to end locally with the bundled carrier simulator — greeting
streamed, caller speech transcribed, reply synthesised and streamed back, turns
written to telemetry. Measured: STT 879 ms, reasoning 1418 ms, TTS 306 ms.

**What is left is not code:** a carrier account, a public host for the gateway,
`MEDIA_GATEWAY_SECRET` on both sides, and `VOICE_STREAM_URL` pointing at it.
See INTEGRATION_REQUIREMENTS.md.

Still genuinely missing on this path:

- **Mute, hold and conference** (§4). The gateway can carry them, but they need
  a control channel from the Agent Desk to a live session, and a real call to
  test against. Accept, reject, transfer-in and wrap-up work today.
- **Listening to live audio** as a supervisor — same reason.

### 2. Localisation — complete

`lib/i18n.ts` + `components/locale-provider.tsx` hold an English source of
truth, per-person language choice, a header switcher, placeholder substitution
so word order belongs to the translation, and **honest coverage reporting**:
`coverage()` and `missingKeys()` name any gap rather than leaking a raw key.

Hindi is at **604/604 keys — everything**. The customer portal (all 30
sections, headings, form and stat labels, accessible names, Org &amp; routing
and Settings end to end), the admin portal, the sign-in screen with its social
buttons, the import, dialer, diagnostics, agent-desk, co-pilot and supervisor
panels, **and now the marketing landing page** — hero, revenue loop,
capabilities, industry tabs, engine family, pricing, security, closing call to
action and footer — plus a language switcher in the landing header. A visitor
whose browser asks for Hindi lands in Hindi.

Two deliberate exceptions. The **demo conversations** stay exactly as written,
because they are the thing being demonstrated — Vaani speaking Hindi, Hinglish
and English — not interface copy. And product nouns Indian users say in English
on the phone (campaign, credits, CRM, SIP, API) are left alone.

Rendering the Hindi page found a typography bug that reading could not:
`uppercase` and wide letter-spacing, used on labels throughout the interface,
are wrong in Devanagari. Uppercase does nothing to the script but shouts the
English nouns embedded in Hindi labels ("LEAD स्कोर"), and letter-spacing pulls
apart conjuncts and matras that must stay joined. Both are now neutralised
document-wide when the interface language is Hindi.

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

**Media gateway.** A standalone service holding the carrier socket the worker
cannot, with 52 assertions covering codecs, resampling, endpointing, barge-in
timing and carrier framing.

**Agent workstation (device/dialer extension).** CSV/TSV/XLSX audience import
with a real preview — every row validated, de-duplicated and suppression-checked
before anything is committed to a campaign — device and connection diagnostics
with a readiness gate that `set_presence` actually enforces, and a **browser
dialer** that carries call audio from the agent's tab with a short-lived
per-call token, so no browser ever holds the gateway secret — plus conference
rooms with supervisor listen, whisper and join, where role and mode are signed
into the token so a listening session cannot promote itself.

**This pass.** Real analytics aggregates with per-language breakdown; report
runs with downloadable CSV; a campaign dialer that runs every gate; delivered
team invitations; a working "Take over"; sign-in providers beyond Google;
tenant create/suspend/reactivate with platform admin sub-roles; an inbound
entry point; and an AI co-pilot for human agents.

**Audio-path measurement (§6).** The dialer measures the socket its voice
actually travels on — frames each way, pacing, dropouts and round trip taken
over that socket rather than over HTTP — stored per leg in
`call_transport_stats` and shown on the call. A separate WebRTC probe reports
the negotiated codec, clock rate and encoder bitrate, and, when
`RTC_ICE_SERVERS` is set, whether media can leave the network directly, only
through a relay, or not at all; without it that verdict is "not tested" rather
than a guess. The pre-call HTTP probe still says it is an HTTP probe. 47
assertions.

**Track A — live defects (FINAL Master Architecture pass).** Nine findings from
auditing all 40 sections against the code; the first three cost money today.

- The **manual refund route** took a bare `requireCustomer` and posted straight
  to Razorpay, bypassing the whole risk matrix. Any member — including a
  read-only analyst — could refund the full value of any matched payment. It now
  runs through `evaluateAction`, respects the authority matrix, and raises an
  approval card instead of refunding when the actor's role is not enough.
- **Platform admin RBAC failed open**: `adminRole()` answered `super_admin` for a
  null column *or a failed query*, and the two live admin routes used
  `requireAdmin` rather than the capability check, so the sub-roles were
  decorative. Existing admins are backfilled once; after that it fails closed to
  read-only, and every action names a required capability.
- **A missing `STRIPE_SECRET_KEY` gave the product away.** The sandbox that
  credits a wallet and issues a paid invoice was keyed on the variable's
  presence, not the environment.
- **Production had no plans and no way to create one** — they were seeded only
  outside production and the panel could only edit. `plan_create` exists now.
- **Approved refunds never executed.** Nothing in the repository updated the
  `refunds` table, so a manager could approve and nothing moved. `executeRefund`
  is the missing half, and success is claimed only when the provider confirms —
  in its own response, or later in a signed `refund.processed` webhook.
- **Agents were offered two tools that did not exist**: `schedule_follow_up`
  (now implemented, on the `scheduled_actions` queue) and `transfer_human` (a
  misspelling of `transfer_to_human`). `scripts/check-agent-tools.mjs` fails the
  build on that class of drift.
- **Two screens reported different conversion counts.** Analytics and Overview
  each guessed a different outcome vocabulary, and Overview's counted one value
  that is never written plus one that exists only on a demo row.
  `lib/call-outcomes.ts` is now the single vocabulary, lifecycle words no longer
  go in the outcome column, and existing rows were migrated.
- **`rent` minted phone numbers nobody owned** (`+91124498xxxx`) and stored them
  as real workspace numbers. §15 says the platform does not resell numbers, so
  the action is gone rather than fixed; the plan limit moved to the connect path.
- **Voice profiles were unguarded and unaudited** — any member could rebind which
  voice an agent speaks with, leaving no trace.

Two more that only running it revealed:

- **The agent had no clock.** Asked to follow up "tomorrow at 6" it produced a
  date from its training data, so every tool taking an absolute timestamp —
  follow-ups and appointments — was unusable for a relative time.
- **`tools_json` is decorative.** The per-agent tool list is shown in the studio
  but never filters what the model receives, which always gets the full set.
  Making that setting mean something is real work for a later track; for now the
  names at least refer to tools that exist.

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
- **A thinking pause was recorded as a network dropout.** A 4.3-second gap
  while the agent reasoned counted as lost audio and dragged a healthy call
  from 100 to 82. A gap is only a dropout inside a stretch of speech; past a
  second the far side simply is not talking, and silence is now reported
  separately from loss.
- **A new column was added to `CREATE TABLE` only**, so a database created by
  the previous build silently lacked it and ending a call returned 500.
- **Devanagari was being uppercased and letter-spaced** — visible only by
  rendering the Hindi page, never by reading the code.
- **The socket round trip was measuring the gateway, not the network.** Pings
  queued behind the media chain, so each one waited for the turn in flight —
  speech-to-text, reasoning, synthesis — and reported 307 ms of jitter on a
  connection whose median round trip was 1 ms. A probe needs no ordering with
  audio, so it is now answered ahead of the queue: jitter fell to 2 ms.
- **Measurements were being title-cased** by a helper built for enum values,
  rendering "15.5 kbps" as "15.5 Kbps".
