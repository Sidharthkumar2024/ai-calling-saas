# Vaani scale and security architecture

## Capacity target and boundary

The production target is **10 million registered users**, not 10 million simultaneous voice calls. The initial capacity envelope is:

- 10 million registered users and 1 million monthly active organizations.
- 250,000 dashboard/API requests per second at peak, absorbed at the edge and across regional cells.
- 100,000 concurrently active voice sessions globally, expanded by adding media cells.
- 5 million call attempts and 250 million workflow/job events per day.
- 99.95% control-plane availability and 99.99% signed-webhook durability.

The localhost/Cloudflare D1 build is the executable product reference and single-cell launch stack. It does not by itself prove this capacity. Reaching the envelope requires the production topology below, load tests at every gate and carrier/provider quota approval.

## Production topology

```text
Web / mobile / API clients
          │
Cloudflare DNS + DDoS + WAF + Bot rules + rate limiting
          │
Global API gateway ─── identity/session service ─── KMS/HSM
          │
Tenant directory → routes every tenant to exactly one home cell
          │
  ┌───────┴──────────────── regional cell N ─────────────────┐
  │ stateless API fleet                                      │
  │ tenant-sharded relational DB + read replicas             │
  │ Redis-compatible cache, locks and idempotency            │
  │ durable queue/event bus + dead-letter topics             │
  │ workflow workers + campaign schedulers                    │
  │ WebRTC/SIP media gateways + provider adapters             │
  │ encrypted object storage for recordings and documents    │
  └───────────────────────────────────────────────────────────┘
          │
CDC/event stream → warehouse/lake → aggregated analytics only
```

Tenant placement is stable and recorded in the global directory. A request is rejected if its signed tenant claim and the resolved home cell disagree. Large tenants can be moved by a journaled, checksum-verified migration or isolated in a dedicated cell without changing application APIs.

## Data isolation and encryption

- TLS 1.3 externally; mTLS with workload identities between internal services.
- AES-256-GCM envelope encryption for integration credentials, SIP passwords and other secrets. Production data-encryption keys are generated per tenant, wrapped by KMS/HSM keys and rotated without rewriting the master key.
- Database, queue, backup and object-store encryption at rest are mandatory. Recordings use tenant-scoped object prefixes, private buckets and short-lived signed playback URLs.
- Phone, email, transcript and recording metadata move to encrypted PII columns in the multi-cell database. Search uses keyed HMAC blind indexes; plaintext is decrypted only inside an authorized tenant service.
- API keys remain hash-only. Passwords use a slow password KDF, sessions are HttpOnly/Secure/SameSite and MFA is supported.
- Every query carries `organization_id`; repository tenant guards and database row-level policies provide two independent boundaries. Cross-tenant admin access is an explicit, audited support workflow.
- Logs never contain raw credentials, full phone numbers, transcript bodies or payment data. Redaction runs before export to observability systems.

## Voice and campaign safety gates

A campaign draft cannot produce a call job until all of the following pass atomically:

1. Agent version is published and belongs to the tenant.
2. Calling number/SIP trunk is active, KYC-approved and allowed for the requested direction.
3. Contact has current purpose-specific consent and no global or tenant suppression match.
4. Local calling window, frequency cap and retry policy permit the attempt.
5. Credits are reserved in an idempotent ledger transaction.
6. Provider quota and cell concurrency tokens are available.

Every job has a globally unique idempotency key. Workers use leases, exponential retry and dead-letter queues; webhook consumers store provider event IDs before applying state changes.

## Availability, recovery and operations

- No database or queue is shared across all cells, limiting blast radius.
- Multi-AZ databases, point-in-time recovery, immutable encrypted backups and quarterly restore drills.
- Regional failover preserves the tenant home-cell rule; voice sessions already in progress fail safely instead of being replayed.
- SLO dashboards cover API latency, media latency/jitter, call setup, provider failure, queue age, workflow failures, credit reconciliation and consent-gate rejection.
- Load gates: 2× expected steady load for 60 minutes, 5× burst for 10 minutes, tenant hot-key tests, queue recovery and provider brownout simulation.
- Incident response includes key revocation, tenant isolation, forensics export, customer notification workflow and auditable deletion.

## Current repository status and remaining activation

Implemented now: tenant-scoped portals/APIs, encrypted secrets, hash-only API keys, signed webhooks, consent/suppression gates, idempotent job records, wallet ledger, private recording paths, audit events, rate limits and secure response headers.

Still required before a public 10-million-user claim: deploy the multi-cell topology, KMS per-tenant keys, encrypted searchable PII columns, external security review and penetration test, carrier load quotas, regional disaster-recovery exercise, 100k-session media load test, SOC 2/ISO control evidence and country-specific telecom/privacy approval. These are production gates rather than features that can be truthfully simulated on localhost.
