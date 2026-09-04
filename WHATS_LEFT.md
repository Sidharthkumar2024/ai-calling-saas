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

- **[KEY] Nothing, in code.** The control channel now exists — see *Controlling
  a live call* under Landed — so mute, hold, resume, supervisor listen/whisper
  and hangup reach a live carrier session, verified against the bundled
  simulator. What is left is a carrier, so that there is a customer leg to
  point it at.

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

### 3. Multi-currency — done, not deferred

**This section was stale.** The FINAL Master Architecture put multi-currency in
scope (§26), and it shipped: `lib/currency.ts`, `lib/rate-cards.ts`,
`lib/price-books.ts`, `lib/workspace-pricing.ts`, `lib/tax.ts`, and the
`fx_rates`, `price_books` and `provider_rate_cards` tables. Invoices carry
their own currency, the FX rate used and the base-currency equivalent.

### 4. Partner / white-label — excluded, not deferred

**This section was stale too.** §2 of the FINAL Master Architecture excludes
partner and reseller white-label explicitly, so this is not a "revisit later"
any more. It is out of scope by decision, and should not be carried as pending
work.

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

**Two-factor authentication is enforced for privileged roles (Blueprint §14).**
Enrolment had existed since the security screen was written — `mfa_begin`,
`mfa_confirm`, a TOTP secret, and a login that demands a code from anybody who
enrolled. What was missing was the word *enforce*: nobody had to. A platform
administrator holding every capability in the product could work with a
password alone, which made the feature reassurance rather than protection.

**Who:** every platform admin, whatever their sub-role — even `analyst` reads
across every tenant, which is exactly the access worth stealing — plus
`customer_owner`, and any workspace `owner` or `admin`, since both carry every
permission in `lib/customer-rbac.ts`. Deliberately *not* agents, support
agents, analysts or sales managers: requiring an authenticator app of every
telecaller on a shift is enforcement theatre paid for by the people least able
to absorb it, and none of them can move money or change who has access.

**How, without locking anyone out.** Refusing to sign in an unenrolled admin
would be a door with no key, because enrolling requires being signed in. So the
session is created and restricted to a three-path allow-list — the security
endpoint, the session read, and logout. Not a prefix match on `/api/auth`: that
would leave `team-invite` open, and a restricted admin must not be able to
invite themselves a second account instead of enrolling.

The gate lives inside `requireCustomer` and `requireAdmin` rather than at each
route, because enforcement that has to be remembered per endpoint is
enforcement that will be missing from the endpoint added next week.

*Found while verifying, and worse than the missing enforcement:* the portal's
loader redirected to `/login` on **any** 403. A restricted account would have
looped — sign in, get refused, bounce back to sign in — with nothing on screen
explaining why, since the credentials were correct. The refusal now carries an
`mfa_required` code, and the portal renders the enrolment panel instead of
redirecting.

**Note for the demo accounts:** all three are privileged, so the first sign-in
will ask for enrolment. That is the intended §14 behaviour, not a fault.


**CRM views, filters, saved views, bulk actions and deduplication (Blueprint
§3.5).** The CRM had one view — a Kanban — a search box and a source dropdown.

- **List/Table view with a one-click switch.** A board is the wrong shape for
  two hundred leads: it hides everything below the fold of each column and
  cannot be sorted or compared.
- **Filters** across stage, owner, campaign, status, intent, score range and
  capture date, combining as AND, with options built from the data. The search
  this replaces could not find a lead by `9812345678` when the number was
  stored as `+91 98123 45678`; digits in the query now match the number however
  either side is punctuated.
- **Saved views**, per person, promotable to the team.
- **Bulk actions**: assign owner, move stage, export CSV, archive. Archive
  rather than delete — a bulk delete behind one click on a multi-select is not
  something to offer. The CSV neutralises values beginning `=`, `+`, `-` or `@`
  so opening an export does not execute a formula.
- **Deduplication and merge**, matched on phone (by its last ten digits, so
  five ways of writing one number are one number) or email.

Merging destroys one of two leads, so the planner reports what it cannot
decide instead of choosing. A field the survivor lacks is filled from the
duplicate; a field they genuinely disagree about is listed and left alone,
because a merge that silently picks one of two email addresses is how a
business loses the one it was actually reaching somebody on. The score is the
best in the group, since a score is evidence accumulated from calls. History —
activities, events, calls — moves to the survivor, and the merged lead is
marked `merged`, never deleted.

Two decisions worth naming. Duplicate groups are **not** chained transitively:
a lead sharing a phone with one and an email with another is, transitively, all
three people, and chaining is exactly how a shared family or office address
merges strangers. And the pipeline query now excludes `merged` and `archived`
leads — without that, both actions would do nothing a person could see, and the
duplicate they had just merged would still be sitting there.

*Found while verifying:* the planner reported `phone` as a conflict when the
two leads held the same number written differently — contradicting the
normalisation the duplicate detection is built on, and burying the real
conflicts in noise. Comparison is now field-appropriate.


**Notification centre (Blueprint §3.2 — the section titled "Fix the Bug You
Identified").** The bell in the portal shell was a placeholder: a dot that was
lit whatever was happening, over the hardcoded sentence "Workspace systems are
healthy", above a button labelled "Open notification center" that navigated to
the alerts screen. There was no centre, no read state, and nothing stored — an
event a person missed was gone.

Each of §3.2's six rules, and what it took:

- **Stored, not just shown.** A `notifications` table, because §3.2 wants read
  state "consistent across tabs/devices" and `localStorage` is neither: a
  notification read on a laptop would be unread on a phone.
- **The single event ID.** Every event carries a dedupe key built from what it
  is *about* — a call id, invoice number, handoff id. Two tabs (or two devices)
  reporting one real event hit a unique index; the second insert returns no
  row, so only the reporter that actually created it toasts. The database
  decides it rather than the tabs trying to agree.
- **Toast lifetime** is ~5s, inside §3.2's 4–6s. It used to be 5s for most
  events and 9s for urgent ones — long enough to annoy, short enough to miss.
- **Critical events stay.** Payment failure, transfer failure and security
  events do not time out at all and carry an Acknowledge button that records
  who cleared them. A generic `error` deliberately is *not* one of these:
  demanding acknowledgement for every failed fetch teaches people to dismiss
  without reading.
- **No stale toast on navigation.** Changing section clears the toasts, except
  the must-acknowledge ones — a failed payment does not stop mattering because
  somebody switched tab.
- **Read state** is central: mark one, mark all, and the dot is dark when
  there is genuinely nothing to see, blue for unread, red when something is
  waiting on a person.

*Verified against the live database*, since the mechanism is the point: a
second report of the same event returns nothing and stores one row; the list
query floats an unacknowledged critical event above newer ones; a
user-scoped notification is invisible to another member; and one member cannot
acknowledge another's.


**The agent is told who it is talking to.** The caller's phone number never
reached the system prompt, on any call. So every tool taking a phone number got
a guess — `agent_tool_calls` holds four invocations of `lookup_customer` with
the literal string `"incoming call"` as the phone. The model could not have
done better; nothing had told it. The prompt now carries the number (inbound:
`from_number`, outbound: `to_number`) with an instruction not to ask for it.

*The first wording was too weak* — it said "pass this when a tool needs it" and
the agent still asked the caller for their number. Rewritten to say the number
is already known and must not be requested.

**An admin can create a plan.** `plan_create` has existed in the API —
capability-mapped, duplicate-checked and audited — and the admin screen only
ever sent `plan_update`, so plans could be edited and never created. Plans are
seeded only outside production, so a fresh production deploy had an empty
`plans` table and no way to fill it: signup works (§3 removed that dependency),
but **no workspace could ever complete onboarding and go live**, because going
live requires a paid plan and there was no plan to buy. The plans section now
has a create form, and says so explicitly when no plans exist.

*Verified in one live call through the carrier simulator,* which proved three
things at once: the agent called `lookup_customer` with `+919812345678` — the
real `from_number` — rather than a guess; `tools_json` filtering works
end-to-end, since the tool only became available once it was added to the
agent's list; and the negative result was classified `answered_no` rather than
counted as a failure.


**Readers for data the product recorded and never showed.** A sweep for tables
that real code writes and no real code reads found six. Two were false
positives — `invoice_sequences` is read through its own UPSERT's `RETURNING`,
`graph_agents` through a helper that builds the SELECT. The rest were real, and
one of them was written earlier in this same session:

- **`lead_events`** carries why a score moved — previous value, new value, and
  every contribution with its own delta. Written to make a score explainable,
  and nothing could read it. Now on the lead card: the change, and "why" opens
  the contributions.
- **`agent_tool_calls`** logs every tool invocation with input, result and
  latency. Now on Analytics, so a workspace choosing which actions to enable
  can see which are used and which fail.
- **`job_attempts`** records every attempt including its error. The health
  panel showed only `background_jobs.last_error` — the most recent failure of
  one job, which cannot say whether it fails *always* (a bad payload) or
  *intermittently* (a provider). Now reported as a pattern.

*The tool reader immediately found a defect.* `lookup_customer` showed 13 calls
and 0 successes. It had never failed once: `ok` is the tool's reply **to the
model**, and "there is no such customer" is a legitimate `ok: false` that the
model needs to hear. The same flag was being stored as an operational health
signal, so a working tool read as 100% broken — invisible while nothing read
the column, and actively misleading the moment something did. Outcomes are now
classified as succeeded / answered-no / rejected-input / failed, and the
backfill turned those 13 failures into 9 answered-no and 4 rejected-input.

Those 4 are a second, real finding: the agent called `lookup_customer` with the
literal string `"incoming call"` as a phone number, because on an inbound call
it is never handed the caller's number and guessed. Not yet fixed.


**Controlling a live call (§4).** Mute, hold, supervisor monitoring and hanging
up were all listed as "the gateway can carry them, but they need a control
channel from the Agent Desk to a live session". Two things were missing, and
the second was the interesting one.

A **carrier leg was never in a room.** The room was opened when the socket
connected, but a carrier only reveals which Vaani call it is on in its *start
frame*, which arrives afterwards — so `room` was always null for a real
customer call. The mixer has had listen and whisper from the beginning and
neither could ever apply to a customer. A carrier leg now opens its room once
it knows the call id, so a supervisor with a token for the same call joins the
same room.

Then the channel itself: `POST /control` on the gateway, shared-secret
authenticated with a six-command allow-list, and `POST /api/app/calls/control`
in the worker, which checks the call belongs to the caller's workspace before
forwarding and audits every command — including the ones that fail. It is
one-directional by necessity: the worker cannot hold a socket, so it commands
and reads the resulting leg state from the response.

Hold is not a louder mute. Mute silences a leg's contribution; hold also
suspends the AI *and discards* inbound audio, because buffering a parked caller
means transcribing their words and answering them several sentences later, out
of context.

*Found while verifying, and worse than the feature:* `stopPlayback()` cleared
the playback timer without settling the promise `play()` awaits. The server
feeds every frame of a call through one serialised queue and `onStart` awaits
the greeting, so interrupting a greeting left that promise pending for ever and
**the queue never drained — the socket stayed open and the session went deaf.**
Barge-in during a greeting hit it too. It survived because the tests use a
200 ms greeting that always finishes on its own, while a real one runs several
seconds. There is now a regression test that fails without the fix.


**`tools_json` actually filters the tools the model receives (§7).** It had been
decorative since the beginning: the agent studio's Actions tab wrote a list, the
list was stored on every agent, and `generateVoiceAgentTurn` passed all fifteen
tool definitions on every turn regardless. A workspace that switched "create
payment link" off still had an agent that would take payments.

Making it filter surfaced why it had never been noticed — **three of the seven
options in the picker were not tools.** `send_email` and `create_ticket` had no
definition and no handler at all, and `transfer_human` was a near-miss for
`transfer_to_human`, so ticking "Transfer to human" wrote a name that matched
nothing. Both agents in the live database carried the wrong one. Nothing read
the list, so nothing ever failed.

Naive filtering would therefore have removed the escalation path: `<action_safety>`
orders the model to call `transfer_to_human` on the turn a caller asks for a
person, and a workspace unticking it would have produced a prompt commanding a
tool the model does not have. So `transfer_to_human`, `request_refund` and
`end_call` are mandatory and not configurable, the picker now renders from the
same list the server filters on, unknown names are dropped and reported,
`transfer_human` is repaired rather than dropped, and a migration fixed the
stored rows.

**An empty selection means every tool, not none.** The column defaults to
`'[]'`, so "nobody opened the picker" and "somebody deselected everything" are
the same value in the database — and only one of those is plausible. Reading
empty as none would have silently lobotomised every existing agent.

The build-time audit now checks the picker's catalogue too, not just the two
default lists — that omission is exactly what let `send_email` survive — and
fails if a tool is implemented but neither selectable nor mandatory, since no
agent could ever call it.


**Notifications, animation and sound (§33).** The product had no notification
surface at all — `components/ui/toast.tsx` existed with no importer anywhere in
the repository, so a caller asking for a person, a payment landing or credits
running out reached an operator only if they were already on the right screen
and refreshed it. There is now an event vocabulary with a synthesised chime and
a distinct animation each: ringing, connected, handoff requested, transfer
accepted, payment received, credits low, credits added, error. Pitch carries
meaning — rising for things that went well, falling for things that need
attention — so the two can be told apart without looking.

Sounds are generated through Web Audio rather than shipped as files: nothing to
load, nothing to license, and no notification that has to finish a network
request before it can tell you something. Mute and volume persist per browser.
**Muting the sound does not mute the message** — the toast still appears.

Every alert is edge-triggered. A live surface repolls, so "a handoff is
waiting" is true on every tick; what earns a sound is the arrival. A rule that
chimed while a condition held would be muted permanently within a day.

The `thinking` voice state finally has its own animation. It had no class at
all and fell through to the same empty string as `idle`, so an agent working on
an answer looked like an agent doing nothing — during the exact pause where a
caller is most likely to talk over it or hang up. Deliberately not another
breathing rate: listening and speaking are both breathing, and a third tempo of
the same motion reads as the same state, faster.

`prefers-reduced-motion` now covers Tailwind's `animate-spin`, `animate-pulse`,
`animate-ping` and `animate-bounce`, which had kept moving while the two custom
animations honoured it. They are not set to `animation: none`: a frozen spinner
says the page has hung, which replaces information with a lie. They become a
slow opacity fade that still reads as "working".


**Global languages (§11).** French, Spanish, Chinese and Japanese join the
catalog, and the catalog is now the only language vocabulary in the product —
the STT router's own list of Indian codes and a `languageName` map inside the
prompt builder are gone. Both had drifted: the router sent Odia and Assamese to
the Indic engine although neither was selectable anywhere, and the prompt map
fell back to *"Hindi written in Devanagari"* for any code it did not recognise,
so a Spanish agent was instructed to open in Hindi.

Synthesis now routes by what an engine can actually speak rather than by which
API key exists. That was the load-bearing part: the old rule sent everything to
the Indic engine unless the language was exactly `en-IN`, and an Indic model
handed French does not fail — it returns audio. Wrong audio is worse than none,
because only one of them is visible, so a capable engine is required and there
is no fallback to an incapable one. Transcription keeps its fallback, which is
the deliberate asymmetry: a wrong transcript is visible in the transcript and
recoverable on the next turn.

The greeting is rendered in the call's language. It used to be one fixed string
per agent, with a hardcoded Hindi sentence when an agent had none — and because
the greeting turn never reaches the model, none of the prompt's language rules
applied to it. A French caller's first words were Hindi.

*Fixed alongside:* ElevenLabs synthesis recorded no units, so every call on the
multilingual engine metered as zero characters and priced as free. Harmless
while it was the minority path; not once §11's four languages all run through
it.


**Sales intelligence loop (§10).** Every call has always produced an outcome,
a sentiment and a list of objections, and all three went into rows nothing read
back. `leads.score` stayed at whatever the enquiry form implied for the life of
the lead. Now `analyseCall` rescores the lead from what was actually said —
outcomes dominate, sentiment adjusts, an objection costs little because arguing
is engagement, and a refusal is the one signal allowed past the per-call bound —
and writes a `lead_events` row carrying every contribution, so a score that
moved can say why. Objections accumulate into an `objection_library` the
workspace can answer; an approved answer, and only an approved answer, is then
briefed to live calls.

*Known limit:* objections merge on wording, not meaning. "The price is too
expensive" and "too expensive for us" become one row; "price too high" and "too
expensive" do not, because they share no words. Same trade-off as knowledge
retrieval, and the same fix if it matters later — embeddings behind
`findMergeTarget`.


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

**Knowledge reaches the call (§36).** The agent's system prompt has always said
it uses "approved knowledge". Nothing ever gave it any: ingestion worked, chunks
were written, and `knowledge_chunks` had exactly one reader in the whole
repository — a search box. So the sentence was aspirational and the model
answered from whatever it already believed.

The search that existed was `content LIKE '%<the whole question>%'`, which
matches only if the document happens to use the caller's exact words. "What's
your refund policy?" matched nothing. Retrieval now scores per term, with
diminishing returns on repetition and a length penalty, so a short passage that
answers the question beats a long one that repeats a word.

It is **not** vector search — there are no embeddings in this runtime — and it
does not pretend to be: every result carries `method: 'keyword'`, and swapping
in embeddings later means changing one function.

Verified live. A booking policy was ingested, then asked *"booking amount kitna
hai aur refundable hai kya?"* — the agent answered **"unit price का 2 percent…
15 din ke andar… पूरा refundable"**, which is what the document says and which it
had no way to know before. Asked something the document does not cover, it said
it would check and follow up instead of inventing a number.

Found while building it: `\p{L}\p{N}` shreds Devanagari. Matras and the anusvara
are combining **marks**, so "रिफंड" split at its own anusvara into "रिफ" and
"ड" and matched nothing — Hindi knowledge would have been silently unsearchable
in a product built for Indian languages.

**Track F — paid onboarding (§3) and Voice Studio (§32).**

**No free production plan.** Signing up now creates a workspace with a
playground and nothing else — no subscription, no plan — and signup no longer
depends on a plan existing at all, which also removes the 503 a production
deploy used to start life in. The wizard is what turns a workspace into
something that can call a real person.

The stage is **derived from evidence, not stored as a flag**. The old
`onboarding_profiles.stage` was written once at signup and never advanced —
a stage nobody moves means nothing, and it could also be skipped by writing to a
column. Nothing here can be skipped without doing the thing: a plan means a
subscription row, payment means a paid invoice with a total above zero, an agent
means a published agent. Verified live: the demo workspace read 75% with
"Business details" as the only blocker, a real outbound call returned **402 —
"Finish setup before placing real calls: Business details"**, and filling in the
legal name moved it to live, after which the call proceeded to the *next* real
check. Integrations and knowledge are deliberately **not** required: marking
every step required would look thorough and make the product unusable.

One consequence handled rather than left: `checkPlanLimit` treated "no plan" as
"no limits", which was defensible when every workspace had one and is wrong now
that an unpaid workspace is the normal case — it would have made a trial *less*
restricted than a paying customer. A workspace with no plan is now held to trial
limits: one agent, no numbers, one concurrent call.

**Voice Studio (§32).** The section's last sentence is the one that matters: no
unauthorised impersonation. A prebuilt library voice needs nothing — the
provider licensed it. A **custom** voice cannot be bound to anything until a
person at the platform has looked at the consent evidence, because the person
whose voice it is cannot be the one clicking the button.

Verified end to end: a one-word statement is refused (*a checkbox is not
consent*); a real submission goes to `pending`; binding while pending is **409**;
a platform reviewer verifies it and binding works; the **kill switch** blocks the
voice *and unbinds it from every agent in every workspace*, because a block that
only applies to the next binding does nothing about the call happening now; and
when the speaker **withdraws** consent, the voice comes off live agents
immediately and cannot be re-bound.

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
