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

**Track E — API Health Center (§29), first pass.** The old health block had two
honest numbers — a timed D1 round trip and the queue depth — and asserted the
rest: `api: 'operational'` was a constant, and a provider's "health" was whether
an environment variable was set.

§29 names five states, and the fifth is what makes the other four usable:
**unknown**. A component nobody has called is not healthy, and the panel now
says so — the live report currently reads `overall: unknown`, because six
providers have no credentials and webhooks have never fired. The old panel would
have shown that as green.

Also measured rather than asserted: last-success timestamps, credential expiry
(with an `expiring` state so a token is renewed before it takes a service down),
webhook delivery health from a table that has always recorded it and was never
surfaced, queue pressure, and circuit breakers with a `half_open` trial so a
recovered provider closes its own breaker instead of staying shut until someone
notices. Maintenance windows win over failures, because a component someone took
down on purpose is not an incident.

35 assertions on the classifier, including that `unknown` outranks `healthy` in
the roll-up: a platform with an unmeasured component is not known to be healthy.

**Support Executive portal (§30).** None of this existed — `impersonation`
appeared once in the whole repository, in a roadmap sentence.

Three rules shape it, each answering a way this goes wrong in practice:

- **The customer grants access, not the operator.** A PIN is minted inside the
  workspace by somebody who works there. Support has no way to let itself in.
- **It ends by itself.** The PIN lives 30 minutes, is single-use and locks after
  five attempts; the session lives an hour. A grant that needs a human to
  remember to close it is a grant that stays open.
- **Exposure is an allow-list, not a filter.** `VISIBLE_FIELDS` names what
  support may read; anything unnamed is invisible, so a column added next year
  is private until someone decides otherwise. A deny-list leaks by default the
  moment the schema grows.

The queue needs no session at all: tenant, plan, a quotable diagnostic code and
a failed-job count answer most tickets without anyone opening anything.

Verified end to end. A guessed PIN is refused; the customer mints one; support
opens a session with it; **the same PIN a second time is refused as already
used**; the view returns workspace, plan, wallet, diagnostics, errors, tickets
and calls with no secret-shaped key anywhere in the payload; the customer
revokes mid-session and the next read is 403. The audit trail reads as the whole
story — `pin_rejected → pin_issued → session_opened → pin_rejected →
view_read → access_revoked` — with every step attributed.

A new `support` platform sub-role holds `tenants.read` and `support.access` and
nothing else: verified 403 on rotating a provider key and on editing a plan.


**Track D — money: rate cards, real metering, cost and margin (§13, §26-28),
first pass.** The admin panel titled "Provider cost and margin" summed columns
that were structurally always zero, because `recordUsage` wrote
`units = 1, provider_cost_micros = 0, billed_credits = 0` on every single
provider call. Metering existed as a table name.

- **Versioned rate cards** (§13), seeded from the document's September 2026
  figures with a `source` on every row saying exactly that — these are published
  reference prices, not a negotiated quote and not a live feed. They are
  versioned by effective date and never edited in place, so a call made last
  month still prices at last month's rate rather than having its margin
  rewritten whenever a provider changes its pricing. The same rows are §34's
  model registry: what you configure per model and what you price per model are
  the same thing.
- **Real metering** (§27). Anthropic turns record the provider's own reported
  input and output token counts; Sarvam speech records characters synthesised.
  Verified live: 4,223 input tokens priced at $1/M → 4,223 micros → ₹350,509
  micros at the recorded rate of 83, with the FX rate stored on the row.
- **Multi-currency** (§26): currency spec with correct minor units, conversion
  that carries the rate and markup it used, four rounding policies, and
  `sell_price = cost / (1 - margin)`. A missing FX rate is an error, never a 1:1
  guess — treating an unknown rate as parity would quietly bill a dollar as a
  rupee.
- **Unit economics** (§28): revenue and cost over the same 30 days in the same
  currency, with gross profit and margin.

The honest part, and the reason the numbers are worth reading: a zero that means
"free" and a zero that means "we could not price this" are identical in a sum,
and every zero the old code wrote was the second kind. Usage events now carry an
`unpriced` flag, the 312 rows written before metering existed were backfilled as
unpriced, and the panel says: *"312 usage events in this window had no rate
card, so the cost above is a floor rather than a total and the margin is
optimistic."* It would have read 100% margin without that line.

**Invoices that an accountant would accept (§27).** The tax was
`Math.round(amount * 0.18)` — a flat rate with no split, no GSTIN on either
party, no HSN/SAC and no place of supply. The number was
`VAI-${year}-${Date.now().slice(-8)}`: neither sequential nor per-tenant, and
two purchases in the same millisecond collided on a UNIQUE index.

Whether GST splits into CGST+SGST or lands as IGST depends on **where the supply
happens**, not on the amount — a flat 18% is right in exactly one of three cases
and silently wrong in the other two. Verified end to end: a Maharashtra GSTIN
produced `VAI/2026-27/00001` with CGST ₹89.91 + SGST ₹89.91, and switching to a
Karnataka GSTIN produced `VAI/2026-27/00002` with IGST ₹179.82 and the note
*"Inter-state supply (Maharashtra → Karnataka); IGST at 18%."* Sequence numbers
are claimed atomically, because a read-then-write would hand two simultaneous
purchases the same number.

The invoice document also stopped ignoring its own data: it had always printed
one hardcoded row reading "Vaani subscription / credit services", whatever had
actually been bought, and now prints the stored line items with HSN/SAC, both
parties' GSTINs, the place of supply and the correct tax split.

**Margin-floor alerts (§28)** run on the existing alert machinery as
`gross_margin_percent`. It returns null — rather than firing — when a workspace
billed nothing in the window, and *also* when any usage event in the window
could not be priced: a floor alert that cannot fire because half the cost is
missing is worse than no alert. Unknown metrics and not-yet-measurable ones are
now reported separately, since one is a mistake to fix and the other is routine.

**Per-workspace currency and country price books (§26), end to end.** Plans and
packages are stored once in the base currency; what a workspace pays comes from
one resolver that everything charging money now calls. A price book entry is an
explicit decision and beats any arithmetic — a rounded conversion is not a
pricing strategy — and when nobody has set one, the price is converted, marked
`derived`, and explained as *"it moves with the exchange rate"*, because a
converted price is provisional in a way a set one is not.

Two real bugs came out of testing it:

- **The Stripe checkout requested `inr` for every customer in the world**, and
  the sandbox path skipped pricing altogether. A workspace switched to USD was
  billed **₹999 as $999** — the base-currency figure charged as dollars, exactly
  what the resolver exists to prevent. The price is now resolved *before* the
  branch, so neither path can go around it. Verified: the same package then
  billed $12.04 converted, $15.00 with a US price book entry, and back to
  ₹999.00 with CGST+SGST on an Indian GSTIN.
- **Psychological rounding behaved as a price rise.** The first rule turned ₹150
  into ₹199 and the second turned $12.04 into $19 — a third and a half added to
  a price by a rounding policy nobody meant that way. It now steps by ten and
  gives up entirely when reaching a 9 would lift the price by more than 5%.


**Track C — Universal Object Engine (§7-9), first pass.** A workspace defines
its own objects and the agent reads real records. Before this there was no
`products`, `catalog` or `inventory` table anywhere: what made Vaani *look*
like a real-estate or commerce product was English prose in a system prompt —
the `real_estate_sales` preset told the model to "answer only from approved
inventory" and there was no inventory for it to read.

- **Schema**: `custom_objects`, `custom_fields`, `records`, `record_values` —
  the names §38 uses. Fourteen field types including currency, relation, geo,
  image, video, 3D URL and inventory.
- **How a record is stored**: `values_json` is the whole record and the source
  of truth; `record_values` is a typed projection of the filterable fields so
  SQLite can index them. The projection is rebuilt from the JSON on every write,
  so the two cannot drift.
- **AI Schema Builder** turns a plain-language business description into a
  proposed schema. §7 says the admin approves, so it *only* proposes — nothing
  in that path writes to the database, and the model's answer is treated as
  untrusted: unknown field types are dropped with a note rather than stored.
- **Templates** for real estate (locality → project → unit), commerce (product
  → variant, with stock) and services. Seeded object definitions, not hardcoded
  tables, so a property business and a bakery run on the same engine.
- **Agent tools** `search_catalog`, `get_catalog_item` and `check_availability`.

Verified on a live playground call: asked for "3BHK, budget 2 crore तक", the
agent called `search_catalog` with `price lte 20000000`, got the two real units
that qualify, and quoted their actual floor and carpet area. The ₹3.1 crore
4BHK was excluded because it is over budget, and a **draft** record with nine
units available never appeared — a record nobody has published is a record
nobody has stood behind, and quoting it on a call would be quoting nobody.

**Orders and digital delivery (§9).** An order is now a distinct thing from a
payment link: a link is a request for money, an order is what the customer
bought, what it costs and what has to reach them. Prices and stock come from the
catalogue records, never from the caller — an agent that could name its own
price would be a discount nobody approved.

The gate: `releaseOrder` is called from **exactly one place**, the payment
provider's verified webhook. Nothing else may mark an order paid, open a
download or move stock. Entitlements are created when the order is placed and
stay shut; the row stores only the token's hash, so a leaked database does not
hand out downloads, and the delivery endpoint is rate-limited against guessing.

Proven step by step against the running app:

| | |
|---|---|
| digital item with no delivery file | refused at the till, not sold |
| download before payment | **402** — "unlocks once the payment is confirmed" |
| unsigned webhook | 404, nothing released |
| matching link, **wrong signature** | **401**, entitlement still `pending` |
| matching link, correct signature | 200, `downloadsReleased: 1` |
| download after | **302** to the asset; order `paid`, stock 100 → 99 |
| same event replayed | `duplicate: true` |
| provider re-sends with a new event id | `alreadyPaid: true`, stock still 99 |

Stock is checked when the order is placed *and* again on the webhook, because
minutes pass between them; a shortfall at that point is reported as a fulfilment
problem rather than hidden, since the money has already arrived.

**Track B — the §4 light design system.** The portal, admin, landing page and
docs are now white/soft-gray/near-black with a blue primary, per §4. The token
layer already held a full light palette that was never reachable, because the
root element hardcoded `dark`; the work was that components bypassed the tokens
— 1,376 `white/NN` alpha utilities across 31 files plus ~150 hex literals.

Swept through one published mapping rather than 1,376 separate decisions, based
on the role each value played on a dark ground:

| was | is | role |
|---|---|---|
| `border-white/*` | `border-hairline` `#E2E8F0` | hairline |
| `bg-white/≤0.03` | `bg-surface-muted` `#F8FAFC` | page / recessed |
| `bg-white/>0.03` | `bg-surface-strong` `#F1F5F9` | panel, hover, chip |
| `text-white/≤48` | `text-ink-muted` `#475569` | muted |
| `text-white/50-68` | `text-ink-body` `#334155` | body |
| `text-white/≥70` | `text-ink` `#111827` | primary |
| near-black `bg-[#…]` | `bg-surface` | panel |
| solid amber/cyan fills | `bg-primary` `#2563EB` | primary action |

Bare `text-white` was deliberately excluded: most of it sits on a chip that is
explicitly dark and stays dark on a light page. The `.dark` block is gone —
keeping a dead palette would invite half the interface to drift back into it.

Verified by measuring, not by looking: a WCAG contrast pass over every rendered
text node on **30 portal screens, 11 admin screens, the landing page and the
docs, in both languages — 0 failures**. It found real problems on the way, and
they are the reason the number is worth quoting:

- §4's `#16A34A` and `#D97706` fall under 4.5:1 as *text* at the label sizes
  this interface uses. The §4 values stay for fills, borders and icons;
  `--success-text` / `--warning-text` / `--danger-text` are one step darker.
- Native `<option>` elements do not inherit the select's colour and fell back to
  the platform grey at 3.6:1.
- The hero headline's gradient text was amber→pink→violet: on white the amber
  end is nearly invisible, and no contrast checker can see it, because gradient
  text is `color: transparent`.
- The lead-capture widget preview paints a background the *customer* chooses.
  Its text had always been hardcoded white — wrong the moment anyone picked a
  light colour — and the sweep made it dark, wrong for the default. It now
  derives a readable ink from whatever colour is set, which is more correct than
  what was there before.

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
