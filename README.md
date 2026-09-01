# Vaani — AI Calling SaaS

Vaani is a multi-tenant revenue voice operating system for lead capture, AI-agent testing, CRM, campaigns, telephony setup, call intelligence, payments and platform administration.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Local customer demo: `owner@vaani.local` / `VaaniUser#2026`

Local admin demo: `admin@vaani.local` / `VaaniAdmin#2026`

## Main routes

- `/` — landing page and browser-agent demos
- `/signup` and `/login` — customer onboarding and login
- `/app` — tenant-scoped customer portal
- `/admin/login` and `/admin` — isolated platform admin portal
- `/docs` — public API and integration documentation
- `/api/internal/jobs` — authenticated/cron worker for scheduled actions, retries and dead letters
- `/api/app/calls` — consent-gated live call start
- `/api/app/compliance` — consent, DNC and secure KYC intake
- `/api/app/knowledge` and `/api/app/workflows/run` — ingestion and durable automation
- `/api/app/team` and `/api/auth/security` — tenant invitations, roles, TOTP MFA and session control

## Development checks

```bash
npm run db:generate
npm run lint
npm run build
```

See [PRODUCT_READINESS.md](./PRODUCT_READINESS.md) for the implemented feature inventory, live-provider requirements and remaining production work.
