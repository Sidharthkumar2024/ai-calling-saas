# Call Vani — plans, contribution and release status

Reviewed 8 September 2026. All amounts below are INR unless explicitly USD. These are a **local commercial catalog and planning scenarios**, not a production launch approval or guaranteed net profit.

## New purchase catalog

| Plan | Monthly software subscription | Agent ceiling | Number / concurrency ceilings | Recurring included voice credits |
| --- | ---: | ---: | --- | ---: |
| Launch | ₹2,999 | 1 | 1 / 1 | 0 |
| Growth | ₹9,999 | 5 | 3 / 3 | 0 |
| Scale | ₹24,999 | 15 | 10 / 10 | 0 |

Launch covers agent configuration, knowledge, playground, CRM and inbox; Growth adds campaigns/workflows/forms/integrations; Scale targets team routing, approvals and API/reporting. These are catalog groupings, not a claim that every entitlement is enforced. Verify all feature, number and concurrency quotas before selling them. Security, consent, opt-out and human escalation are baseline controls, not premium safety add-ons. No unsupported seat, unlimited-call, SSO or white-label promises are included.

New packs: 1,000 credits ₹1,900; 5,000 ₹9,500; 20,000 ₹38,000. No volume discount until measured unit economics supports it. Taxes, carrier/rental charges and premium-provider usage are additional and require an explicit final tariff before production. Signup continues to grant 100 playground trial credits without creating a paid subscription.

Catalog `2026-09-08-v1` is published once transactionally. Only the three old seeded plans and three old packs become legacy. Existing subscriptions, purchased credit quantities and old plan terms are not rewritten. Verified delayed checkout fulfillment accepts legacy plans; the new checkout endpoint accepts active plans only. Existing pre-funded credits do not retroactively become new-price credits.

## What a credit currently buys

| Path | Current implementation | Important limit |
| --- | --- | --- |
| Text playground | 10 credits / turn | Reservation and concurrent-send idempotency remain pending |
| Realtime browser playground | 10 credits / `realtime_session_v1` reservation | **Session, not minute.** Trusted duration settlement is not implemented |
| Exotel completed call callback | 10 credits / started minute, minimum one | Atomic per-call settlement; a final overage may leave a negative wallet balance |
| Other voice paths | Not uniformly settled | Do not advertise a universal per-minute credit tariff yet |

At new pack prices 10 credits cost ₹19. That supports a **target** of ₹19 per standard AI minute only after all duration-metering gates pass. A long realtime session currently costing 10 credits is not evidence that ₹19 buys unlimited voice time profitably. Do not enable unrestricted paid use before server duration limits and settlement are implemented.

## Profit estimate

Planning assumptions: sell ₹19/AI minute, variable cost budget ₹10.50/minute including contingency, and collection allowance 3% of revenue. Carrier, premium voice, number rentals and tax are excluded/pass-through and must not be absorbed silently. FX ₹90/USD is an explicit scenario, **not a current exchange-rate quote**.

Per-minute contribution = `19 − 10.50 − (19 × 3%) = ₹7.93`, or **41.7%**. This is not net profit. Deduct salaries, support, fixed infrastructure, sales, refunds, fraud and other overhead to estimate operating profit. No measured usage mix or overhead dataset was supplied.

| Plan scenario | AI minutes / month | Subscription + usage revenue | Variable + collection allowance | Contribution before fixed costs | Margin |
| --- | ---: | ---: | ---: | ---: | ---: |
| Launch | 500 | ₹12,499 | ₹5,624.97 | ₹6,874.03 | 55.0% |
| Growth | 2,000 | ₹47,999 | ₹22,439.97 | ₹25,559.03 | 53.2% |
| Scale | 10,000 | ₹2,14,999 | ₹1,11,449.97 | ₹1,03,549.03 | 48.2% |

For example, allocating ₹10,000 fixed overhead to the Growth scenario leaves ₹15,559.03 before remaining taxes/other expenses. It is an allocation example, not a forecast. At a ₹14 variable cost, usage contribution falls to ₹4.43/minute (23.3%); price or route restrictions would need changing.

## Which AI will cost most?

The recommended India-oriented planning stack is **Sarvam STT + Sarvam reasoning + Bulbul v3 TTS**. This does not force every existing agent onto it or change its selected live provider. Default/actual model usage differs by route; determine actual spend from measured provider usage and invoices, not brand labels.

In the conservative high-speech scenario below, **TTS is the largest component**, not the language model:

| Component | Published unit rate | Assumed use per call minute | Estimated cost |
| --- | --- | ---: | ---: |
| Sarvam STT | ₹30/audio hour | 1 audio minute | ₹0.50 |
| Sarvam 105B input | ₹29.28 / million tokens | 7,698 tokens (6 × 1,283) | ₹0.2254 |
| Sarvam 105B output | ₹73.20 / million tokens | 948 tokens (6 × 158) | ₹0.0694 |
| Bulbul v3 TTS | ₹30 / 10,000 characters | 2,520 characters (6 × 420) | ₹7.56 |
| Own variable infrastructure | Planning assumption | 1 minute | ₹0.75 |

Subtotal ≈₹9.105; adding 10% contingency ≈₹10.015; rounded budget **₹10.50**. Character/turn volumes are a stress-planning assumption, not recorded customer behavior. Sarvam published prices: [API pricing](https://www.sarvam.ai/api-pricing), [developer pricing](https://docs.sarvam.ai/api/getting-started/pricing).

Deepgram fits transcription/language coverage requirements. Nova-3 multilingual streaming lists $0.0092/min regular and $0.0058 promotional; Aura-2 TTS $0.030/1,000 characters. Use the regular eligible rate and measured language/model before budgeting. Buffered STT support in this build is not a completed low-latency streaming gateway. [Deepgram pricing](https://deepgram.com/pricing).

ElevenLabs is a premium voice option: Flash/Turbo API starts at $0.05/1,000 characters; v2/v3 $0.10. At 2,520 characters and the assumed FX, Flash TTS alone is ₹11.34, before STT, LLM and carrier. Do not absorb it into the standard ₹19 rate without measured usage caps or a premium cost-plus tariff. Webhook callbacks are event delivery, not a replacement for paying for synthesis. [ElevenLabs API pricing](https://elevenlabs.io/pricing/api).

Do not double-count a managed voice engine plus STT/LLM/TTS components already included in that engine. Admin cost estimation now selects a defined **INR Sarvam scenario**, rather than mistakenly picking the cheapest raw number across INR and USD. It remains an estimate; unsupported carrier or infrastructure rates remain unpriced, not silently free.

## Competitor cross-check

- Retell example: $0.055 infrastructure + $0.015 standard voice + $0.016 selected LLM = **$0.086/minute**, excluding carrier/add-ons. With FX90, ₹0.75 own variable allowance and 10% contingency, the benchmark is ₹9.339/minute. This is a comparison, not our supplier quote. [Retell pricing](https://www.retellai.com/pricing).
- Bolna lists a standard reference from **$0.06/minute**; the component/pay-as-you-go model separately lists a platform fee and provider charges. Do not assume both product configurations have the same all-inclusive cost. [Bolna pricing](https://www.bolna.ai/pricing), [pricing documentation](https://docs.bolna.ai/pricing).
- Deepgram Voice Agent lists regular **$0.075/minute**; the $0.056 promotion ends around 12 September. Do not build a permanent plan around an expiring promotional rate. Carrier remains separate. [Deepgram pricing](https://deepgram.com/pricing).

## WhatsApp India

Reference per delivered message: marketing **₹0.8631**, utility **₹0.1150**, domestic authentication **₹0.1150**, applicable international authentication **₹2.4971**. Recipient market, volume tier and category matter. Eligible service-window messaging is free of Meta message charges, not necessarily free of BSP or AI processing costs. [Meta official pricing](https://whatsappbusiness.com/products/platform-pricing/).

A user message opens a rolling 24-hour service window. Service and eligible utility replies can be free then; marketing is not generally free. Approved templates/opt-in still apply outside the relevant window. Do not advertise “send Hi and all WhatsApp is free.” Keep message category, Meta/BSP invoice and AI usage as distinct ledger components before offering a WhatsApp bundle.

## Release gates and verification

Completed locally: corrected branding, real circular/inverse-rotating provider orbit, pause/reduced motion, two-column mobile source strip, green API documentation, copyable examples, OpenAPI 3.1 endpoint, new catalog and contribution view, realtime atomic reservation/refund, atomic duplicate-safe Exotel settlement, active-organization check on public API keys, legacy paid-checkout fulfillment protection.

Not completed: unified live voice duration/turn settlement; durable reconciliation UI/jobs; WhatsApp bot/Flows publish-runtime bridge; Meta Embedded Signup lifecycle; final WhatsApp/SMS delivery receipt reconciliation; recurring subscription invoice handling; full role/plan enforcement; production storage/credential lifecycle and live connector acceptance. The local UI layer now includes customer rate-card visibility, admin rate editing, BYO SMS send/debit and a stronger WhatsApp Command Center, but these do not replace provider acceptance and production settlement. See `PRODUCT_AUDIT_2026-09-08.md` for the remaining P0/P1 checklist. These are not all missing-key blockers—several still need code.

Verification uses isolated SQLite/synthetic provider data. No real purchase, call or WhatsApp message was sent. Local catalog rows changed; production was not deployed. Browser widths 320/390/1440 checked; API copy button and OpenAPI HTTP 200 checked. Regression commands are in the audit.

## Visual asset record

Sites workflow preserved the existing green direction and used rendered browser checks. Imagegen corrected only the phone wordmark. Final asset: `public/media/call-vani-phone.png`, 1024×1536. The generator produced an opaque outer checkerboard despite the alpha request; CSS clips the displayed product viewport, verified on the page. The old source file is retained, not deleted.

Exact edit prompt:

```text
Use case: text-localization
Asset type: transparent landing-page phone product image
Input images: Image 1 is the sole edit target.
Primary request: Correct ONLY the lime wordmark on the phone screen from "Call Vaani" to the exact text "Call Vani". Spell it C-a-l-l, space, V-a-n-i. Remove the extra a. Keep the same centered placement beneath the waveform, same font style, font size, weight, lime color, and glow.
Constraints: Preserve the black titanium phone shape, front-facing centered composition, camera cutout, edges, metallic texture, reflections, deep emerald screen artwork, lime waveform icon, and all other design details unchanged. Keep the entire phone in frame. The region outside the phone must be genuinely transparent with real alpha, not a painted checkerboard or opaque backdrop. Preserve clean phone edges and the image's 1024×1536 portrait dimensions. No new elements, no extra text, no variants.
```
