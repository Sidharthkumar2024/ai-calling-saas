# Universal AI Business + Calling OS — pending list

Compared with `Universal_AI_Business_Calling_OS_Architecture.pdf` on 2026-09-06.

## Already covered in the local SaaS

- Multi-tenant auth, customer/admin panels, RBAC, sessions, MFA and audit logs.
- Agent lifecycle: draft, test, ready, publish, pause, archive, clone and versions.
- CRM, leads, campaigns, workflows, graph agents, knowledge base and retargeting.
- Browser voice playground, call history, transcripts, summaries, recording references,
  live monitoring, QA, alerts, reports and supervisor handoff.
- WhatsApp send policy, payment-link flow, signed WhatsApp webhook, document inbox
  ingestion and the new tenant-scoped WhatsApp inbox API.
- Lead forms/widget builder, Meta/Google lead source model, webhooks and API keys.
- Numbers, SIP trunk records, KYC workflow, provider usage/latency telemetry,
  billing/credits/invoices and support tickets.
- Private R2/S3 configuration surface and recording authorization path.

## Pending or only partially implemented

### P0 — required before calling the PDF architecture production-complete

1. **Universal object engine completion** — finish customer-facing category trees,
   variants, inventory, media assets, relations, searchable custom fields and
   computed fields end to end. The current object APIs are the foundation, not the
   full listing/inventory studio described in the PDF.
2. **AI schema builder** — business discovery should propose object types, fields,
   CRM stages and workflows, then persist an approval/publish step. Current AI
   manager recommendations are not yet a complete schema-generation flow.
3. **Real second carrier** — Twilio/alternate telephony adapter, signed callbacks,
   failover routing and carrier-level DTMF/packet-loss validation still require
   implementation plus a verified carrier account.
4. **Production media gateway** — deploy the WebSocket gateway regionally with
   `MEDIA_GATEWAY_SECRET`, public WSS, autoscaling, barge-in load tests and a real
   carrier leg. Local simulator coverage is not a production carrier test.
5. **WhatsApp inbox UI and reply workflow** — the tenant-scoped inbox API and
   inbound persistence exist; a polished inbox screen, thread view, reply composer,
   template picker, delivery states and assignment/hand-off UI remain.
6. **Private storage activation** — bind R2/S3, KMS/encryption, malware/MIME scan,
   lifecycle/retention jobs, backup/restore drill and signed-download monitoring.
7. **Customer-owned integrations** — complete official OAuth/app-install flows and
   incremental sync/reconciliation for Google, Shopify, HubSpot, CRM and commerce.
   The catalog and encrypted connection model do not equal live provider sync.
8. **Payment separation** — finish tenant merchant gateway onboarding, test/live
   mode separation, webhook reconciliation and refund/chargeback handling for
   customer end-customer payments.
9. **Historical-call intelligence** — complete 50–70-call ingestion, consent gate,
   transcription/mining, winning/failed pattern extraction, playbook/evaluation-set
   approval and regression scoring. Existing playbook and objection tools are the
   groundwork.
10. **Advanced prompt/voice evaluation** — add repeatable scenario datasets,
    side-by-side voice/prompt A/B runs, latency/cost/quality scorecards and
    regression gates before publishing an agent.

### P1 — enterprise and operational completeness

11. **Enterprise SSO** — implement OIDC/SAML metadata registration, domain
    verification, claims mapping, JIT provisioning, logout/session policy and
    break-glass admin access. Current SSO/SCIM is configuration scaffolding only.
12. **SCIM 2.0** — implement `/api/scim/v2` users/groups, bearer-token rotation,
    create/update/deactivate semantics, audit events and idempotency.
13. **Agent squads and automated handoff** — add squad membership, skill-based
    routing, capacity/priority rules, transfer context, timeout/fallback and a
    full handoff audit trail across AI and human queues.
14. **Advanced resolution tools** — industry-neutral resolution policies for order
    lookup, refunds, appointments, payment links, document requests and human
    escalation with per-agent permissions and approval thresholds.
15. **Model/voice registry** — admin-managed model catalog, approved voice library,
    country/language filters, rate cards, quality scorecards and fallback policies.
16. **Super-admin global templates** — reusable object schemas, agent starters,
    workflow templates, field types, WhatsApp templates and versioned publishing.
17. **Compliance operations** — complete TRAI/DLT registration evidence, consent and
    recording disclosure variants, DNC enforcement tests, deletion/export workflows,
    privacy review and industry-specific legal sign-off.

### P2 — scale architecture and hardening

18. **10-million-user infrastructure** — move production core to Postgres with
    replicas/partitioning, Redis cluster, event bus, durable workers, analytics
    store, regional media workers and CDN/WAF deployment.
19. **Scale testing** — load-test concurrent calls, webhook bursts, WhatsApp media,
    imports and campaign spikes; establish p50/p95/p99 SLOs and provider quotas.
20. **Reliability drills** — tested database restore, storage restore, provider
    outage/fallback, webhook replay, queue dead-letter recovery and incident runbooks.
21. **Observability** — OpenTelemetry traces, tenant/provider dashboards, alert
    routing, cost anomaly detection and redacted centralized logs.
22. **Native mobile apps** — Android and iOS agent/supervisor apps are not part of
    the current local web product.

## External activation gates (not solvable by repository code alone)

- Production Sarvam/OpenAI/Anthropic/ElevenLabs keys and quotas.
- Verified Exotel/Twilio/SIP numbers, KYC, public WSS and carrier callbacks.
- Meta Business verification and approved WhatsApp templates.
- R2/S3 account, private bucket, KMS and lifecycle policy.
- Resend/SMTP sending domain and DNS authentication.
- Google/Shopify/HubSpot/Meta OAuth apps and production redirect URLs.
- Razorpay/Stripe live merchant accounts and signed webhook secrets.
- OIDC/SAML identity-provider metadata and SCIM authorization.
- TRAI/DLT, privacy, consent, recording and data-retention legal approvals.

## Recommended next implementation order

1. WhatsApp inbox UI + replies.
2. Object/listing studio + AI schema builder.
3. Production storage activation and document scanning/retention.
4. Official OAuth connectors and tenant payment onboarding.
5. Historical-call mining + prompt/voice evaluation.
6. SSO/SCIM and squads/handoff.
7. Production media deployment, scale tests and 10M hardening.
