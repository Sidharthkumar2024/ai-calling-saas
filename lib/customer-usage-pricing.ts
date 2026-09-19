export type CustomerUsageCategory =
  | 'call'
  | 'ai_voice'
  | 'whatsapp'
  | 'sms'
  | 'email'
  | 'storage'
  | 'testing';

export type CustomerUsageUnit =
  | 'minute'
  | 'message'
  | 'email'
  | 'test'
  | 'gb_month';

export type CustomerUsageRate = {
  id: string;
  category: CustomerUsageCategory;
  operation: string;
  label: string;
  unit: CustomerUsageUnit;
  credits: number;
  costBasis: string;
  customerNote: string;
  marginNote: string;
  status?: 'active' | 'retired';
  updatedAt?: string;
};

/**
 * Customer-facing tariff in Call Vani credits.
 *
 * Provider rate cards measure our cost. This table is what the customer sees
 * and what the wallet debits. Keep it boring, explicit and editable later from
 * admin: every billable action must map to one of these ids before credits are
 * held or deducted.
 */
export const CUSTOMER_USAGE_RATES: CustomerUsageRate[] = [
  {
    id: 'call_inbound_minute',
    category: 'call',
    operation: 'inbound',
    label: 'Inbound call minute',
    unit: 'minute',
    credits: 8,
    costBasis: 'Call Vani inbound call handling + media gateway',
    customerNote: 'Call Vani fee per started connected minute. Your carrier bills its own usage separately.',
    marginNote: 'Cover platform processing costs; exclude customer-paid carrier costs.',
  },
  {
    id: 'call_outbound_minute',
    category: 'call',
    operation: 'outbound',
    label: 'Outbound call minute',
    unit: 'minute',
    credits: 12,
    costBasis: 'Call Vani outbound call handling + dialing control',
    customerNote: 'Call Vani fee per started minute after answer. Your carrier bills its own usage separately.',
    marginNote: 'Cover dialing and orchestration costs; exclude customer-paid carrier costs.',
  },
  {
    id: 'ai_voice_minute',
    category: 'ai_voice',
    operation: 'conversation',
    label: 'AI voice processing',
    unit: 'minute',
    credits: 18,
    costBasis: 'Configured STT + language model + supported speech engine',
    customerNote: 'Charged while the AI is actively listening or speaking.',
    marginNote: 'Main margin line; tune after real provider invoices.',
  },
  {
    id: 'test_call',
    category: 'testing',
    operation: 'agent_test',
    label: 'Agent test call',
    unit: 'test',
    credits: 10,
    costBasis: 'One reserved test session',
    customerNote: 'Held when a test starts; released if the test never starts.',
    marginNote: 'Matches existing realtime reservation minimum.',
  },
  {
    id: 'whatsapp_marketing_message',
    category: 'whatsapp',
    operation: 'marketing_template',
    label: 'WhatsApp marketing template',
    unit: 'message',
    credits: 6,
    costBasis: 'Meta country/category charge + platform markup',
    customerNote: 'Estimated before send; final debit after Meta webhook.',
    marginNote: 'Admin rate card must be adjusted per country and Meta tier.',
  },
  {
    id: 'whatsapp_utility_message',
    category: 'whatsapp',
    operation: 'utility_template',
    label: 'WhatsApp utility template',
    unit: 'message',
    credits: 3,
    costBasis: 'Meta utility/authentication charge + platform markup',
    customerNote: 'Used for confirmations, reminders and OTP-like updates.',
    marginNote: 'Lower-margin but high-volume operational traffic.',
  },
  {
    id: 'whatsapp_service_reply',
    category: 'whatsapp',
    operation: 'service_reply',
    label: 'WhatsApp service reply',
    unit: 'message',
    credits: 1,
    costBasis: 'Open service-window message + automation',
    customerNote: 'Used inside the active customer support window.',
    marginNote: 'Keep cheap so inbox automation adoption stays high.',
  },
  {
    id: 'sms_message',
    category: 'sms',
    operation: 'send',
    label: 'SMS message',
    unit: 'message',
    credits: 2,
    costBasis: 'Connected SMS provider or managed SMS route',
    customerNote: 'Charged per submitted SMS segment.',
    marginNote: 'Segment count must be used once provider response is known.',
  },
  {
    id: 'email_send',
    category: 'email',
    operation: 'send',
    label: 'Email send',
    unit: 'email',
    credits: 1,
    costBasis: 'Connected email provider or managed email route',
    customerNote: 'Charged when the email provider accepts the message.',
    marginNote: 'Mostly platform margin unless using managed email.',
  },
  {
    id: 'recording_storage_gb_month',
    category: 'storage',
    operation: 'recording_storage',
    label: 'Recording storage',
    unit: 'gb_month',
    credits: 50,
    costBasis: 'Object storage + retention controls',
    customerNote: 'Charged monthly for retained recordings and transcripts.',
    marginNote: 'Apply retention plans before billing this at scale.',
  },
];

export function usageRateById(id: string) {
  return CUSTOMER_USAGE_RATES.find((rate) => rate.id === id) ?? null;
}

export async function customerUsageRates(): Promise<CustomerUsageRate[]> {
  try {
    const { ensureSchema } = await import('@/db/bootstrap');
    const { getRawDb } = await import('@/db/index');
    await ensureSchema();
    const db = getRawDb();
    const result = await db
      .prepare(
        `SELECT id, category, operation, label, unit, credits, cost_basis,
          customer_note, margin_note, status, updated_at
         FROM customer_usage_rates
         ORDER BY category, operation, id`,
      )
      .all<{
        id: string;
        category: CustomerUsageCategory;
        operation: string;
        label: string;
        unit: CustomerUsageUnit;
        credits: number;
        cost_basis: string;
        customer_note: string;
        margin_note: string;
        status: 'active' | 'retired';
        updated_at: string;
      }>();
    const rows = result.results ?? [];
    if (rows.length) {
      return rows.map((row) => ({
        id: row.id,
        category: row.category,
        operation: row.operation,
        label: row.label,
        unit: row.unit,
        credits: Number(row.credits),
        costBasis: row.cost_basis,
        customerNote: row.customer_note,
        marginNote: row.margin_note,
        status: row.status,
        updatedAt: row.updated_at,
      }));
    }
  } catch {
    // Keep billing routes alive during bootstrap or isolated unit tests; the
    // seeded constants are still safe defaults.
  }
  return CUSTOMER_USAGE_RATES;
}

export async function customerUsageRateById(id: string) {
  const rates = await customerUsageRates();
  return rates.find((rate) => rate.id === id) ?? null;
}

export function estimateUsageCredits(rateId: string, quantity: number) {
  const rate = usageRateById(rateId);
  if (!rate) throw new Error('Usage rate not found.');
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw new Error('Usage quantity must be positive.');
  const billableQuantity =
    rate.unit === 'minute' ? Math.ceil(quantity) : Math.ceil(quantity);
  return {
    rate,
    quantity: billableQuantity,
    credits: billableQuantity * rate.credits,
  };
}

export async function estimateCustomerUsageCredits(
  rateId: string,
  quantity: number,
) {
  const rate = await customerUsageRateById(rateId);
  if (!rate || rate.status === 'retired') throw new Error('Usage rate not found.');
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw new Error('Usage quantity must be positive.');
  const billableQuantity =
    rate.unit === 'minute' ? Math.ceil(quantity) : Math.ceil(quantity);
  return {
    rate,
    quantity: billableQuantity,
    credits: billableQuantity * rate.credits,
  };
}
