import { getRawDb } from '@/db/index';
import { estimateCustomerUsageCredits } from '@/lib/customer-usage-pricing';

export type UsageWalletResult = {
  referenceId: string;
  organizationId: string;
  estimatedCredits: number;
  finalCredits?: number;
  balance: number;
  status: 'held' | 'insufficient' | 'finalized' | 'released' | 'already_done';
};

async function walletBalance(organizationId: string) {
  const row = await getRawDb()
    .prepare(
      `SELECT balance FROM organization_wallets WHERE organization_id = ? LIMIT 1`,
    )
    .bind(organizationId)
    .first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}

function holdLedgerId(referenceId: string) {
  return `usage_hold_${referenceId}`;
}

function finalLedgerId(referenceId: string) {
  return `usage_final_${referenceId}`;
}

function releaseLedgerId(referenceId: string) {
  return `usage_release_${referenceId}`;
}

export async function holdUsageCredits(input: {
  organizationId: string;
  referenceType: string;
  referenceId: string;
  rateId: string;
  quantity: number;
  description?: string;
}): Promise<UsageWalletResult> {
  const priced = await estimateCustomerUsageCredits(
    input.rateId,
    input.quantity,
  );
  const db = getRawDb();
  await db
    .prepare(
      `INSERT OR IGNORE INTO organization_wallets
       (organization_id, balance, low_balance_threshold)
       VALUES (?, 0, 500)`,
    )
    .bind(input.organizationId)
    .run();

  const existingHold = await db
    .prepare(
      `SELECT amount FROM credit_ledger WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(holdLedgerId(input.referenceId), input.organizationId)
    .first<{ amount: number }>();
  if (existingHold) {
    return {
      referenceId: input.referenceId,
      organizationId: input.organizationId,
      estimatedCredits: Math.abs(Number(existingHold.amount)),
      balance: await walletBalance(input.organizationId),
      status: 'already_done',
    };
  }

  await db.batch([
    db
      .prepare(
        `INSERT INTO credit_ledger
         (id, organization_id, type, amount, balance_after, reference_type, reference_id, description)
         SELECT ?, organization_id, 'hold', ?, balance - ?, ?, ?, ?
         FROM organization_wallets WHERE organization_id = ? AND balance >= ?`,
      )
      .bind(
        holdLedgerId(input.referenceId),
        -priced.credits,
        priced.credits,
        input.referenceType,
        input.referenceId,
        input.description ??
          `${priced.rate.label} hold (${priced.quantity} ${priced.rate.unit})`,
        input.organizationId,
        priced.credits,
      ),
    db
      .prepare(
        `UPDATE organization_wallets
         SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = ?
           AND EXISTS (
             SELECT 1 FROM credit_ledger
             WHERE id = ? AND organization_id = ?
           )`,
      )
      .bind(
        priced.credits,
        input.organizationId,
        holdLedgerId(input.referenceId),
        input.organizationId,
      ),
  ]);
  const inserted = await db
    .prepare(
      `SELECT id FROM credit_ledger WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(holdLedgerId(input.referenceId), input.organizationId)
    .first<{ id: string }>();
  if (!inserted) {
    return {
      referenceId: input.referenceId,
      organizationId: input.organizationId,
      estimatedCredits: priced.credits,
      balance: await walletBalance(input.organizationId),
      status: 'insufficient',
    };
  }

  return {
    referenceId: input.referenceId,
    organizationId: input.organizationId,
    estimatedCredits: priced.credits,
    balance: await walletBalance(input.organizationId),
    status: 'held',
  };
}

export async function finalizeUsageCredits(input: {
  organizationId: string;
  referenceType: string;
  referenceId: string;
  rateId: string;
  quantity: number;
  description?: string;
}): Promise<UsageWalletResult> {
  const priced = await estimateCustomerUsageCredits(
    input.rateId,
    input.quantity,
  );
  const db = getRawDb();
  const [hold, finalized, released] = await Promise.all([
    db
      .prepare(
        `SELECT amount FROM credit_ledger WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(holdLedgerId(input.referenceId), input.organizationId)
      .first<{ amount: number }>(),
    db
      .prepare(
        `SELECT id FROM credit_ledger WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(finalLedgerId(input.referenceId), input.organizationId)
      .first<{ id: string }>(),
    db
      .prepare(
        `SELECT id FROM credit_ledger WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(releaseLedgerId(input.referenceId), input.organizationId)
      .first<{ id: string }>(),
  ]);
  if (finalized || released) {
    return {
      referenceId: input.referenceId,
      organizationId: input.organizationId,
      estimatedCredits: Math.abs(Number(hold?.amount ?? 0)),
      finalCredits: priced.credits,
      balance: await walletBalance(input.organizationId),
      status: 'already_done',
    };
  }
  if (!hold) throw new Error('Usage hold not found.');

  const held = Math.abs(Number(hold.amount));
  const delta = priced.credits - held;
  const statements: D1PreparedStatement[] = [];
  if (delta !== 0) {
    statements.push(
      db
        .prepare(
          `UPDATE organization_wallets
           SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = ?`,
        )
        .bind(delta, input.organizationId),
      db
        .prepare(
          `INSERT INTO credit_ledger
           (id, organization_id, type, amount, balance_after, reference_type, reference_id, description)
           SELECT ?, organization_id, ?, ?, balance, ?, ?, ?
           FROM organization_wallets WHERE organization_id = ?`,
        )
        .bind(
          finalLedgerId(input.referenceId),
          delta > 0 ? 'usage' : 'refund',
          -delta,
          input.referenceType,
          input.referenceId,
          input.description ??
            `${priced.rate.label} final adjustment (${priced.quantity} ${priced.rate.unit})`,
          input.organizationId,
        ),
    );
  } else {
    statements.push(
      db
        .prepare(
          `INSERT INTO credit_ledger
           (id, organization_id, type, amount, balance_after, reference_type, reference_id, description)
           SELECT ?, organization_id, 'usage_final', 0, balance, ?, ?, ?
           FROM organization_wallets WHERE organization_id = ?`,
        )
        .bind(
          finalLedgerId(input.referenceId),
          input.referenceType,
          input.referenceId,
          input.description ??
            `${priced.rate.label} finalized at held estimate (${priced.quantity} ${priced.rate.unit})`,
          input.organizationId,
        ),
    );
  }
  await db.batch(statements);
  return {
    referenceId: input.referenceId,
    organizationId: input.organizationId,
    estimatedCredits: held,
    finalCredits: priced.credits,
    balance: await walletBalance(input.organizationId),
    status: 'finalized',
  };
}

export async function releaseUsageHold(input: {
  organizationId: string;
  referenceType: string;
  referenceId: string;
  reason?: string;
}): Promise<UsageWalletResult> {
  const db = getRawDb();
  const [hold, released, finalized] = await Promise.all([
    db
      .prepare(
        `SELECT amount FROM credit_ledger WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(holdLedgerId(input.referenceId), input.organizationId)
      .first<{ amount: number }>(),
    db
      .prepare(
        `SELECT id FROM credit_ledger WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(releaseLedgerId(input.referenceId), input.organizationId)
      .first<{ id: string }>(),
    db
      .prepare(
        `SELECT id FROM credit_ledger WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(finalLedgerId(input.referenceId), input.organizationId)
      .first<{ id: string }>(),
  ]);
  if (released || finalized || !hold) {
    return {
      referenceId: input.referenceId,
      organizationId: input.organizationId,
      estimatedCredits: Math.abs(Number(hold?.amount ?? 0)),
      balance: await walletBalance(input.organizationId),
      status: 'already_done',
    };
  }
  const held = Math.abs(Number(hold.amount));
  await db.batch([
    db
      .prepare(
        `UPDATE organization_wallets
         SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = ?`,
      )
      .bind(held, input.organizationId),
    db
      .prepare(
        `INSERT INTO credit_ledger
         (id, organization_id, type, amount, balance_after, reference_type, reference_id, description)
         SELECT ?, organization_id, 'refund', ?, balance, ?, ?, ?
         FROM organization_wallets WHERE organization_id = ?`,
      )
      .bind(
        releaseLedgerId(input.referenceId),
        held,
        input.referenceType,
        input.referenceId,
        input.reason ?? 'Usage failed before provider acceptance; hold released',
        input.organizationId,
      ),
  ]);
  return {
    referenceId: input.referenceId,
    organizationId: input.organizationId,
    estimatedCredits: held,
    balance: await walletBalance(input.organizationId),
    status: 'released',
  };
}
