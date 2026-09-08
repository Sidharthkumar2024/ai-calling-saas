/** Research snapshot, NOT an active billing tariff. Re-verify before publishing. */
export const PRICING_REVIEW_DATE = '8 September 2026';
export const WHATSAPP_INDIA = {
  marketing: 0.8631,
  utility: 0.115,
  authentication: 0.115,
  authentication_international: 2.4971,
  service: 0,
};
export const PROPOSED_PLANS = [
  {
    name: 'Launch',
    monthly: 2999,
    seats: 2,
    agents: 1,
    concurrency: 1,
    features: 'Agent setup, knowledge base, inbox, basic CRM and call history',
  },
  {
    name: 'Growth',
    monthly: 9999,
    seats: 5,
    agents: 5,
    concurrency: 3,
    features:
      'Launch + campaigns, workflows, appointments and standard integrations',
  },
  {
    name: 'Scale',
    monthly: 24999,
    seats: 15,
    agents: 15,
    concurrency: 10,
    features:
      'Growth + multi-team routing, API, supervisor reporting and approvals',
  },
];
export function benchmarkMinute(fx: number, sell: number) {
  if (!Number.isFinite(fx) || fx <= 0 || !Number.isFinite(sell) || sell <= 0)
    return null;
  const bufferedCost = (0.086 * fx + 0.75) * 1.1;
  return {
    bufferedCost,
    floorPrice: bufferedCost / (1 - 0.4 - 0.03),
    margin: (sell - bufferedCost - sell * 0.03) / sell,
  };
}
