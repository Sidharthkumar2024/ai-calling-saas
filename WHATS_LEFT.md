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
- **[CODE] Real WebRTC statistics (§6).** Codec, bitrate and true packet loss
  come from an RTCPeerConnection. The browser leg streams over a WebSocket,
  which is simpler and works; the diagnostics measure HTTP round trips and say
  so rather than inventing call-media numbers.

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

### 2. [CODE] Localized dashboard — chrome and headings done

`lib/i18n.ts` + `components/locale-provider.tsx` hold an English source of
truth, per-person language choice (not per workspace — two people in one
workspace can want different languages, and the workspace setting already means
which languages the AI may speak), a header switcher, and **honest coverage
reporting**: `coverage()` and `missingKeys()` say exactly what is untranslated
instead of rendering raw keys.

Translated today (Hindi, 113/113 keys, 100%): every navigation group and all 30
sections, the shell chrome, shared loading/error/empty states, shared actions,
and **every screen's eyebrow, title, description and primary button** across
the operations screens, dialer, diagnostics, agent desk, wallboard and org
routing.

**Not yet translated:** field labels and helper text inside forms, and the
long-form copy in less-visited panels. Everything falls back to English rather
than showing a broken mix, and a missing key is reported by `missingKeys()`
rather than leaking as a raw identifier.

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
