# Call Vaani landing refresh — 8 September 2026

## Delivered scope

This pass implements the latest screenshot-based landing/branding request. Prior backend, billing and WhatsApp changes in the worktree are preserved; this is not a claim that every live integration has been tested or activated.

- The supplied introduction scrubs only through the meaningful first 6.36 seconds of the 8.52-second video. Its white ending crossfades into a permanently mounted Call Vaani phone scene, with accessible copy, signup/demo links and floating notifications. Video controls remain hidden and playback remains muted.
- Media loading failures, blocked playback and reduced motion show the product fallback rather than a long empty pinned section. Intentional play/pause AbortErrors are ignored. Obscured links are inert while the main heading remains accessible.
- Reworked the call-story previews, category ribbons and language cards. Added a capabilities/proof section using actual catalog counts, not competitors’ customer numbers or reviews.
- Added the connected-tools diagram, three setup cards, five interactive workforce previews, approval/context cards and branded dark phone CTA/footer.
- Admissions, reception, customer operations, finance and hiring previews support play, pause, restart, reset, step progression and tab changes. These are clearly labelled illustrative workflows—not real calls, audio recordings, CRM updates, payments or hiring decisions.
- Display branding is Call Vaani across touched landing, auth, app/admin labels and metadata. Stored voice names, IDs, routes, headers, database values and credentials remain unchanged. An explicit display helper handles catalog labels without migrating stored values.
- Google uses its official multicolour raster mark. Meta, Google Ads, WhatsApp, Razorpay, HubSpot, Sheets and other supported providers use named Simple Icons exports and their supplied brand colours. Unavailable marks retain a neutral integration icon rather than an invented logo.
- Existing footer destinations remain Terms, Privacy, documentation, signup, login and pricing. No public admin or placeholder-page links were added.
- On screens below 375px the platform action is available inside the navigation sheet, preventing the longer Call Vaani wordmark from pushing the menu outside its pill.

## Verification

| Check                              | Result                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production `npm run build`         | Pass; existing large-chunk/plugin-timing notices remain                                                                                                                   |
| `npx tsc --noEmit`                 | Pass                                                                                                                                                                      |
| `npm run lint`                     | Pass                                                                                                                                                                      |
| `scripts/test-landing-refresh.mjs` | 327 assertions, no external calls                                                                                                                                         |
| `scripts/test-i18n.mjs`            | 16 assertions, full EN/HI catalog parity                                                                                                                                  |
| `npm run test:ui-safety`           | Pass: 169 assertions across credit, call, notification, billing, password-reset and Google-auth checks; auth/billing use isolated SQLite and synthetic provider responses |
| Desktop browser, 1440×900          | Opening film, end handoff, story progression, category/language panels, tool diagram, workforce tabs and legal footer visually inspected                                  |
| Mobile browser, 390×844            | Phone handoff, login, signup, Google asset, role tabs and navigation sheet checked; no horizontal page overflow                                                           |
| Narrow mobile, 320×740             | Header clipping found and corrected by placing platform action in the menu                                                                                                |
| Workforce interaction              | Admissions completed all five steps; pause/restart/reset and all five tab transitions checked; switching roles starts a fresh preview                                     |
| Approval example                   | Approve and reset state checked; clearly indicates no real action                                                                                                         |
| Assets and console                 | No broken landing images; inspected landing/auth browser logs contained no errors or warnings                                                                             |

Reduced-motion branches were code-reviewed; OS reduced-motion emulation and a real Safari device were not part of the browser pass. No real signup, password change, checkout, paid call, provider connection or outbound message was performed. Google is currently admin-disabled locally; signup remains email-first. Full OAuth activation still requires valid admin configuration.

## Design sources and content treatment

- User screenshots and [Equal AI](https://myequal.ai): pale green/white rhythm, phone plus notifications, scrolling feature explanation, language/category panels and large brand footer.
- User screenshots and [ConversAI Labs](https://www.conversailabs.com): connected tools, three-step setup, role-based workforce preview and control/context cards.
- All new copy describes this platform. Competitor wordmarks, testimonials, review identities, usage counts and customer logos were not imported.
- [Google sign-in branding guidelines](https://developers.google.com/identity/branding-guidelines) and [official Google G asset](https://developers.google.com/static/identity/images/g-logo.png). Local asset: `public/brands/google-g.png`.
- Provider paths/colours come from the installed `simple-icons` 16.29 package. Trademarks identify integrations, not partnerships or endorsements. Shared implementation: `components/provider-logo.tsx`.

## Generated asset record

One original phone asset was generated with `image_gen__imagegen`, inspected, and copied without raster editing to `public/media/call-vaani-phone.png`. Resolution: 1024×1536 RGBA, with actual transparent corners. The same asset is reused for the intro, proof section, CTA and branded metadata; the old unused social graphic remains on disk.

Original output:
`/Users/sidharthkumar/.codex/generated_images/01a07f37-c977-7a30-8b7c-51b5a3ddcfe7/exec-499d7ab3-cb0c-474d-8c23-d8d802301321.png`

Full generation prompt:

```text
Use case: product-mockup
Asset type: reusable transparent raster hero asset for the Call Vaani landing page.
Scene/backdrop: genuinely transparent background with alpha, isolated phone cutout; if transparency is unavailable use uniform pure white.
Primary request: one beautiful front-facing premium dark titanium smartphone, entire phone visible, portrait composition.
Style/medium: photorealistic premium studio product render, precise realistic physical construction.
Composition/framing: exactly straight-on front view, upright, no tilt or perspective skew, single phone centered and large, tightly framed with modest clear margin on all sides; phone occupies most image height.
Materials/textures: slim dark titanium metallic bezel with subtle fine grain, gently rounded corners, dark glass with restrained realistic reflections, small pill-shaped camera island and small quiet status bar at top.
Screen: deep forest-black, subtle emerald glow, calm and intentionally empty except for centered bright lime wordmark and minimal waveform icon. Leave generous empty screen space for later HTML overlays.
Text (verbatim): "Call Vaani" — spelled C-a-l-l space V-a-a-n-i. Render exactly once at center of the screen in clean modern sans-serif, bright lime green, with a small minimal lime waveform icon directly above it.
Lighting/mood: sophisticated soft studio light, subtle metallic edge highlights, understated glass reflections, restrained emerald glow.
Constraints: single isolated phone only; entire phone visible; no competitor marks; no fake UI text; no floating notifications; no cards, buttons, extra captions, props, scene, floor, or watermark. Do not add any other wordmarks or text. Preserve transparent alpha in output.
```

The Sites building guidance influenced reusable assets, honest demo states, readable responsive sections and local browser checks; the React checklist influenced effect cleanup and accessibility fixes. Work remains local at `http://localhost:3000/`; nothing was deployed.
