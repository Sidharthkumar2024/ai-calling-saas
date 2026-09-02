# Vaani — What's left (feature backlog)

Status (2026-09-02): product is ~90% built. Landing, customer portal (24 sections),
admin portal, ~50 API routes, DB, billing, integrations, compliance, durable jobs are
all coded. This file lists only what genuinely remains.

Legend: **[CODE]** engineering in this repo · **[KEY]** external account/key you supply
(no code) · **[POLISH]** UI/UX.

## ✅ Done in recent sessions

- Demo agent renamed **Maya → Aira** (source + live DB).
- Browser voice made instant: removed the failed server-TTS round-trip, added
  ~0.8s fast turn-taking, guarded the false "mic did not complete" error.
- Multilingual demo conversation fixed: **Punjabi** added, language switch now
  **persists**, warmer human lines, anti-repetition, deterministic switch ack.
- Premium hero: sunset (amber→pink→violet) color grading, value-forward slogan.
- Docs: copy-to-clipboard buttons on every code block.
- Google sign-in button already present and admin-gated.

## A. Genuine engineering left

1. **[CODE+KEY] Truly human, real-time voice** — the WebRTC OpenAI-Realtime path
   with barge-in is coded; it turns on when `OPENAI_API_KEY` is set. Until then the
   demo uses browser STT/TTS (robotic, ~1s STT delay) — a browser limit, not code.
2. **[KEY] Human voice timbre + Punjabi voice** — male & female voices exist in the
   catalog (Tara/Meera/Riya, Kabir/Arjun/Veer, etc.); real human sound needs an
   **ElevenLabs/Sarvam key**. Add a Punjabi TTS voice id once the key is in.
3. **[CODE] Connected-LLM tone pass** — with an Anthropic/OpenAI key, open-discovery
   turns already route to the LLM; tune the system prompts per industry for tone.
4. **[CODE] Customer-side RBAC depth** — manager/agent/viewer roles inside a tenant.
5. **[CODE] Admin billing/invoice/API-management depth** — richer invoice + provider
   cost/margin surfaces.

## B. Design-judgment (need your call)

6. Landing/portal polish beyond the hero (demo card, stat chips, other sections).
7. How close to Bolna's integration layout (you chose: same features, better design).

## C. External activation — you supply (admin panel toggles on)

- OpenAI (+ Realtime model), ElevenLabs + voice ids, Sarvam.
- Exotel/Twilio number + carrier KYC + webhook/SIP.
- Razorpay + Stripe live keys + signed webhooks.
- Meta WhatsApp business + approved templates; Meta/Google Lead Ads OAuth.
- Google OAuth app (activates the existing Google button).
- Private R2/S3 for recordings; transactional email (Resend/SMTP).

## D. Ship

- Push per track to `github.com/Sidharthkumar2024/ai-calling-saas` (ongoing).
