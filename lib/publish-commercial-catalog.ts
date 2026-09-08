import { PLANS, CREDIT_PACKS, CATALOG_VERSION } from './commercial-catalog';
/** One-time, versioned catalog publication. Does not edit contracts or wallets. */
export async function publishCommercialCatalog(db: D1Database) {
  const id = `catalog_${CATALOG_VERSION}`;
  if (
    await db
      .prepare('SELECT id FROM billing_events WHERE id = ?')
      .bind(id)
      .first()
  )
    return;
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO billing_events (id, external_event_id, event_type, payload_json) VALUES (?, ?, 'catalog.published', '{}')`,
        )
        .bind(id, id),
      ...PLANS.map((p) =>
        db
          .prepare(
            `INSERT INTO plans (id, code, name, monthly_price, included_credits, max_agents, max_numbers, concurrency, features_json, status) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'active')`,
          )
          .bind(
            p.id,
            p.code,
            p.name,
            p.monthly * 100,
            p.agents,
            p.numbers,
            p.concurrency,
            JSON.stringify(p.features),
          ),
      ),
      ...CREDIT_PACKS.map((p) =>
        db
          .prepare(
            `INSERT INTO credit_packages (id, name, credits, amount, status) VALUES (?, ?, ?, ?, 'active')`,
          )
          .bind(p.id, p.name, p.credits, p.amount),
      ),
      db.prepare(
        `UPDATE plans SET status = 'legacy' WHERE id IN ('plan_free', 'plan_growth', 'plan_scale')`,
      ),
      db.prepare(
        `UPDATE credit_packages SET status = 'legacy' WHERE id IN ('credits_1000', 'credits_5000', 'credits_20000')`,
      ),
    ]);
  } catch (error) {
    if (
      !(await db
        .prepare('SELECT id FROM billing_events WHERE id = ?')
        .bind(id)
        .first())
    )
      throw error;
  }
}
