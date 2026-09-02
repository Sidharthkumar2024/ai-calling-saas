# Vaani — What's left

Status (2026-09-03). Tracks 0-3 of the AI-Calling-OS plan have landed. This file
lists what genuinely remains, and deliberately records what was **removed** —
several screens used to render permanently fake data, which made the backlog
look shorter than it was.

Legend: **[CODE]** engineering in this repo · **[KEY]** external account/key you
supply (no code) · **[POLISH]** UI/UX · **[DECIDED]** deferred on purpose.

## Landed recently

**Track 0 — truth and safety**
- RBAC holes closed: `crm.manage`, `calls.monitor`, `support.manage` are enforced
  server-side; an unknown member role now fails closed; report/alert writes moved
  off the read-only `analytics.view` onto `analytics.manage`; an admin can no
  longer demote another admin; recordings are permissioned, rate-limited, audited.
- The admin health panel reports measured values (timed D1 probe, real queue
  depth, computed p95) instead of hardcoded literals. The fabricated call-ops and
  voice-engine screens were rebuilt on real data.
- Alerts actually fire: true p95 over `provider_usage_events`, plus
  `call_failure_rate`, `qa_not_passed_rate`, `queue_backlog`,
  `provider_error_rate`; one incident per breach; auto-resolve on recovery;
  channels delivered as `outbound_messages`.
- Scheduler documented and scripted (`npm run jobs:tick`).
- Settings honour the submitted language set (Punjabi included) and no longer
  reset retention, QA sampling and redaction on save.

**Track 1 — call telemetry**
- `call_turns`, `transcripts`, `summaries`, `call_participants`, `recordings`.
- A `call.intelligence` job writes summary, intent, sentiment, objections, next
  action and caller name, plus a real QA review sampled at `qa_sample_rate`.
- Call-detail drawer with the transcript and per-turn tool timeline.
- Recordings return an honest 404 instead of a synthesised tone.

**Track 2 — queues and human handoff**
- `queues`, `queue_members`, `routing_rules`; four routing strategies with
  capacity, priority and overflow; Agent Desk and supervisor wallboard (polling,
  because the runtime has no WebSocket or Durable Object binding).

**Track 3 — org structure and routing**
- `branches`, `departments`, `teams`, `shifts`, `agent_languages`,
  `number_routes`, `contacts`; shift-aware availability; per-number routing;
  `max_numbers` and plan concurrency enforced.

**Defects found and fixed while testing**
- The agent answered the *previous* question: playground history was ordered by
  a one-second-precision timestamp, so same-second turns came back scrambled.
- `transfer_to_human` read `skill`/`language` that its schema never declared, so
  no transfer could reach a skill queue.
- **Creating a campaign always failed** — the INSERT had eight placeholders and
  seven bindings. `npm test` now includes a repo-wide check for that class of bug.
- `lib/job-queue.ts` and `lib/call-telemetry.ts` formed an import cycle.

## A. Genuine engineering left

1. **[CODE+KEY] Inbound telephony.** There is no inbound entry point — the Exotel
   webhook only updates existing outbound calls. `number_routes` is configured and
   resolvable but has no live consumer until a carrier can deliver inbound calls
   to a webhook. Outbound is also gated: `POST /api/app/calls` returns 503 without
   `VOICE_STREAM_URL`.
2. **[CODE] Bidirectional media gateway.** Blocked on runtime capability as well
   as on a carrier: the worker has no WebSocket, Durable Object or queue-consumer
   binding, so a media socket cannot live here. It needs a separate service.
3. **[CODE] Reports produce no artefact.** `report.generate` bumps
   `last_generated_at` and writes no file or table.
4. **[CODE] Campaign execution.** Campaigns can be created and hold contacts, but
   nothing dials them; `call_jobs` is still an orphan table with no writers.
5. **[CODE] Live monitor actions.** "Listen" and "Take over" have no handler.
6. **[CODE] Team invitations are never delivered** — production returns
   `delivery: 'email_pending'` and no email is sent.
7. **[CODE] Analytics depth.** `leads: 0` is hardcoded and the view is a
   last-100-rows window rather than a real aggregate.
8. **[CODE] Admin RBAC granularity.** `requireAdmin` is a single
   `role === 'platform_admin'` boolean; there are no admin sub-roles, and no API
   to create, suspend or impersonate an organization.
9. **[CODE] Non-Google sign-in providers** report `configured: false`
   unconditionally, so none can be enabled.

## B. External activation — you supply (admin panel toggles it on)

- **A male ElevenLabs voice id** (still outstanding) and a Punjabi voice id.
- Sarvam (Indian-language STT/TTS), OpenAI (Realtime path).
- Exotel/Twilio number + carrier KYC + inbound webhook/SIP.
- Razorpay/Stripe live keys + signed webhooks.
- Meta WhatsApp business + approved templates; Meta/Google Lead Ads OAuth.
- Google OAuth app (activates the existing, admin-gated Google button).
- `CRON_SECRET` plus a scheduler (see INTEGRATION_REQUIREMENTS.md).
- Private R2/S3 for recordings; transactional email (Resend/SMTP).

**Rotate the three keys that were pasted into chat** — treat them as exposed.

## C. Deferred on purpose

- **[DECIDED] Partner / white-label (Track 4).** Needs org hierarchy, per-partner
  branding and domains, markup pricing, commission accounting and a second
  billing rollup — it touches tenant isolation and billing everywhere. Revisit
  once the core product has real usage and reliability.
