import { getRawDb } from '@/db/index';
import {
  liveCallGate,
  onboardingState,
  type OnboardingState,
} from '@/lib/onboarding';

/**
 * Gathers the evidence the onboarding state is derived from (§3).
 *
 * Every fact is a query against something that had to actually happen. The
 * previous `onboarding_profiles.stage` column was written once at signup and
 * never advanced — a stage nobody moves is a stage that means nothing, and it
 * could also be skipped by writing to a column. Nothing here can be skipped
 * without doing the thing.
 */
export async function workspaceOnboarding(
  organizationId: string,
): Promise<OnboardingState> {
  const db = getRawDb();
  const row = await db
    .prepare(
      `SELECT
         (SELECT count(*) FROM subscriptions WHERE organization_id = ?) AS plans,
         (SELECT count(*) FROM organization_settings
            WHERE organization_id = ?
              AND coalesce(legal_name, '') != ''
              AND (coalesce(billing_country,'IN') != 'IN' OR coalesce(gstin,'') != '')
         ) AS business,
         (SELECT count(*) FROM kyc_documents WHERE organization_id = ?) AS documents,
         (SELECT count(*) FROM invoices
            WHERE organization_id = ? AND status = 'paid' AND total > 0) AS paid,
         (SELECT count(*) FROM integration_connections
            WHERE organization_id = ? AND status = 'connected') AS integrations,
         (SELECT count(*) FROM knowledge_sources
            WHERE organization_id = ? AND status = 'ready') AS knowledge,
         (SELECT count(*) FROM voice_agents
            WHERE organization_id = ? AND status NOT IN ('draft','archived')) AS agents,
         (SELECT count(*) FROM agent_test_sessions WHERE organization_id = ?) AS playground`,
    )
    .bind(
      organizationId,
      organizationId,
      organizationId,
      organizationId,
      organizationId,
      organizationId,
      organizationId,
      organizationId,
    )
    .first<{
      plans: number;
      business: number;
      documents: number;
      paid: number;
      integrations: number;
      knowledge: number;
      agents: number;
      playground: number;
    }>();

  return onboardingState({
    planSelected: Number(row?.plans ?? 0) > 0,
    businessDetails: Number(row?.business ?? 0) > 0,
    documents: Number(row?.documents ?? 0) > 0,
    // A paid invoice with a total above zero. A ₹0 invoice is not evidence that
    // anyone paid for anything.
    paid: Number(row?.paid ?? 0) > 0,
    integrations: Number(row?.integrations ?? 0) > 0,
    knowledge: Number(row?.knowledge ?? 0) > 0,
    agentReady: Number(row?.agents ?? 0) > 0,
    playgroundTested: Number(row?.playground ?? 0) > 0,
  });
}

/**
 * The gate every real-call path calls before dialling anyone.
 *
 * Deliberately not applied to the playground: §3 gives a new workspace a
 * playground precisely so it can hear the agent before paying.
 */
export async function assertCanPlaceRealCall(organizationId: string) {
  const state = await workspaceOnboarding(organizationId);
  return liveCallGate(state);
}
