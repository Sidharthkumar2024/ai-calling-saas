/** New purchases only. Existing subscriptions and prepaid balances are preserved. */
export const CATALOG_VERSION = '2026-09-08-v1';
export const CREDIT_PRICE_INR = 1.9;
export const STANDARD_MINUTE_BUDGET_INR = 10.5;
export const PLANS = [
  {
    id: 'plan_launch_20260908',
    code: 'launch_20260908',
    name: 'Launch',
    monthly: 2999,
    agents: 1,
    numbers: 1,
    concurrency: 1,
    features: [
      '1 AI agent',
      'Knowledge base & playground',
      'CRM & shared inbox',
      'Usage purchased separately',
    ],
  },
  {
    id: 'plan_growth_20260908',
    code: 'growth_20260908',
    name: 'Growth',
    monthly: 9999,
    agents: 5,
    numbers: 3,
    concurrency: 3,
    features: [
      '5 AI agents',
      'Campaigns & workflows',
      'Lead forms & integrations',
      'Usage purchased separately',
    ],
  },
  {
    id: 'plan_scale_20260908',
    code: 'scale_20260908',
    name: 'Scale',
    monthly: 24999,
    agents: 15,
    numbers: 10,
    concurrency: 10,
    features: [
      '15 AI agents',
      'Team routing & approvals',
      'API & supervisor reporting',
      'Usage purchased separately',
    ],
  },
] as const;
export const CREDIT_PACKS = [1000, 5000, 20000].map((credits) => ({
  id: `credits_${credits}_20260908`,
  name: `${credits.toLocaleString('en-IN')} credits`,
  credits,
  amount: credits * 190,
}));
export function contribution(monthly: number, minutes: number, fixedCosts = 0) {
  if (
    ![monthly, minutes, fixedCosts].every((n) => Number.isFinite(n) && n >= 0)
  )
    return null;
  const revenue = monthly + minutes * 19;
  const variable = minutes * STANDARD_MINUTE_BUDGET_INR;
  const collection = revenue * 0.03;
  const gross = revenue - variable - collection;
  return {
    revenue,
    variable,
    collection,
    gross,
    afterFixed: gross - fixedCosts,
    margin: revenue ? gross / revenue : null,
  };
}
