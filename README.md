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

## Development checks

```bash
npm run db:generate
npm run lint
npm run build
```

See [PRODUCT_READINESS.md](./PRODUCT_READINESS.md) for the implemented feature inventory, live-provider requirements and remaining production work.
