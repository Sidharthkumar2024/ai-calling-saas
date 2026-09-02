# Vaani — What's left (feature backlog)

Status snapshot (2026-09-02): the product is already ~85–90% built. Landing page, customer
portal (24 sections), admin portal, ~50 API routes, DB schema, billing, integrations,
compliance and durable job queue are all coded. Google sign-in buttons already exist and are
already admin-gated ("Admin disabled" badge). What remains is grouped below.

Legend: **[CODE]** = real engineering work in this repo · **[KEY]** = external account/API key
you must supply (no code) · **[POLISH]** = UI/UX/bug.

---

## A. Genuine engineering left (highest value)

1. **[CODE] Realtime low-latency voice gateway** — this is the "slow response / not instant"
   problem. Today the browser demo is request→think→reply. Needs a streaming
   `STT → LLM(streaming) → TTS(streaming)` WebSocket media gateway with **barge-in**
   (interrupt while AI is speaking) and regional routing. Target p50 < 800 ms first-audio.
   → OpenAI Realtime API is the fastest path for telephonic.

2. **[CODE] Multi-language live switching + credit metering** — let the caller/user switch
   English ↔ Hindi ↔ Haryanvi mid-conversation, inside the app and on calls. Wire the
   **credit rule: 100 credits → 10 credits per unit** deduction into the live call ledger
   (currently credits exist but the 10-per-unit call metering needs to be enforced end-to-end).

3. **[CODE] Prebuilt AI agent "personalities"** — Sales agent, Support agent, Collections,
   Real-estate, Lead-qualification presets, each with predefined tone/goals/guardrails, so the
   product works across industries out of the box. (Presets file exists — needs the full set +
   tone adaptation to how the customer speaks.)

4. **[CODE] WhatsApp payment-link flow on call** — when a caller asks for a payment link, AI
   asks "sir, is this your WhatsApp number?", confirms, then sends the link. Backend records
   exist; the on-call conversational trigger + confirmation step needs wiring.

5. **[CODE] Integrations parity with Bolna** — SIP, trunk, my-number, call history,
   organization, API docs. Sections are scaffolded; make the integration cards actually
   connect/test/save exactly like Bolna's panel (ditto layout you asked for).

6. **[CODE] Admin billing/invoice/API management depth** — invoice management, per-tenant API
   key management, provider cost/margin, credit top-ups and refunds surfaced in admin.

7. **[CODE] Ticket system round-trip** — user raises ticket → lands in admin → admin
   reply/assign/status. (Backend + UI exist; verify the full loop and notifications.)

8. **[CODE] Customer-side role-based access** — managers/agents inside a customer org
   (owner already exists; add manager/agent/viewer roles + permission gating).

9. **[CODE] Voice picker** — Hindi/English/seasonal voices, country filter, pulled from
   ElevenLabs, shown in agent studio.

## B. Design-judgment items (need your confirmation before I build)

10. **Copy Bolna user panel + landing page** — layout/flow parity. I'll match structure; you
    confirm how close to "ditto" vs. our own polish.
11. **Copy Retell landing page + selected pieces** (QA, alerting, live monitoring, analytics,
    call recording look). Pick the exact pieces you want.
12. **Color system upgrade** — make admin + customer portals read as a premium SaaS, not an
    "AI toy". Landing page more impressive.

## C. Polish / bugs

13. **[POLISH] Overlapping issue** — need the exact page where you saw it (I checked
    Overview/sidebar and they're clean; the sidebar nav scrolls correctly).
14. **[POLISH] Forgot-password flow** — endpoint exists; verify UI round-trip.

## D. External activation — you must supply (no code, admin panel toggles them on)

- OpenAI key (+ Realtime model), ElevenLabs key + voice IDs, Sarvam key.
- Exotel/Twilio number + carrier KYC + webhook/SIP.
- Razorpay + Stripe live keys + signed webhooks.
- Meta WhatsApp business + approved templates; Meta/Google Lead Ads OAuth apps.
- Google OAuth app (to activate the existing Google sign-in button).
- Private R2/S3 bucket for recordings; transactional email (Resend/SMTP).

## E. Ship

- Push to GitHub (`github.com/Sidharthkumar2024/ai-calling-saas`) once a track lands.
