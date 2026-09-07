# VANI UI and account-flow review — 7 September 2026

## Delivered locally

- White, forest-green and soft green workspace palette shared by customer/admin shells. More readable account, playground and business-manager typography.
- Login and three-step signup restyled. Removed demo passwords and prefilled credentials from the rendered login page. Signup validates account fields before advancing and supports form submission with Enter.
- Browser playground has a responsive circular green orb, explicit Start/End controls, elapsed time and honest connection states. On medium desktops, editor and playground are side by side instead of stacking the playground after the entire editor.
- AI Business Manager starts with workspace-sourced summary cards and chat; business-discovery context is collapsible. Loading and saving failures are visible.
- Golden coin animation only follows a confirmed credit receipt. Opening billing, redirecting to checkout, loading an existing balance or previewing a notification sound does not trigger a purchase celebration. Zero-credit plans can still complete without coin rain. Reduced-motion preferences suppress the rain.
- Customer call/handoff notifications use actual queue-status transitions. First poll is silent; browser test calls do not masquerade as ringing phone calls. Sound is opt-in, with volume and a preview that does not create a fake payment event.
- Public footer contains Terms, Privacy, documentation, signup, login and pricing links. No public admin-login or Phase 2 navigation. Large VANI wordmark and green-accent CTA.
- Added `/terms` and `/privacy` as clearly marked pre-launch drafts; no invented company identity or support contact.

## Backend changes

- Login/signup malformed payloads return safe errors rather than raw exception messages. Login identifiers are normalised before rate limiting.
- Google OAuth requires enabled/active configuration and all credentials, binds state to the initiating browser, consumes state atomically and does not bypass an enabled authenticator. Google account creation is not advertised as ready.
- Existing MFA enrolment cannot be silently replaced by starting enrolment again.
- Password replacement, token consumption and session revocation run in one transaction. Production password-reset email delivery is not wired: requests now report this instead of claiming an email was sent.
- Credit wallet, invoice, invoice sequence and ledger write atomically. Plan activation is in the same transaction. An external checkout uses a tenant-scoped deterministic invoice key; repeated/concurrent deliveries cannot double-credit it or replay an older plan over a newer purchase.
- Stripe delayed-payment success is handled; unpaid checkout completion does not grant credits. Checkout-return verification reads a tenant-owned paid invoice and its purchase ledger entry before the UI celebrates.
- Notification polling requests compact, tenant-scoped call/handoff metadata, not transcripts or recordings.

## Verification

- Existing local customer and admin credentials successfully signed in. No passwords changed and no test account created.
- Signup step 1 → business → first-agent settings exercised without submitting account creation. Mobile width 390px: no document overflow.
- Customer manager and agent studio inspected in browser. Desktop 1440px: studio and playground remain within document bounds. Admin command centre inspected.
- Footer and Terms/Privacy navigation inspected. Local page width 652px: no document overflow.
- Six malformed login/signup HTTP requests returned safe `400` responses without creating accounts.
- `npm run test:ui-safety`: 100 assertions covering receipt validation, notification policy, call transitions, actual billing service against isolated SQLite and password-reset rollback/replay against isolated SQLite.
- Existing `npm test`, TypeScript check, lint and production build passed. These are local automated checks, not evidence of a production deployment or provider certification.

## Still requires configuration or live validation

- Production password recovery needs an email provider and verified sending domain. MFA recovery-code login/replacement workflow remains a separate task.
- Google OAuth stays controlled by the administrator; a real provider login/consent round trip was not run.
- No live microphone session, external phone call, WhatsApp delivery, handoff to a human or real payment was initiated. Browser voice latency and audible notification playback have not been measured in this review.
- Call notifications poll every five seconds while visible; very short transitions can be missed. Durable event streaming is required for stronger real-time guarantees at scale.
- Legal drafts need the operating entity, contacts, refund/retention terms and qualified review before public launch.
- The attached Growth Manager blueprint informed the UX review. This pass does not certify every roadmap item in that document as implemented or production-ready.

Changes are local only. No deployment, GitHub push or provider-account configuration was performed.
