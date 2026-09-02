/**
 * Policy & Risk Engine (handoff architecture §4, §13).
 *
 * The language model may understand the caller and extract facts, but it must
 * never decide whether a financial action is allowed. This module is
 * deterministic: given the facts, the tenant's policy and the actor's role, it
 * returns one decision. Every financial action records the policy version that
 * authorised or blocked it.
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'restricted';

export type ActionDecision =
  | 'auto_execute'
  | 'manager_approval'
  | 'human_only'
  | 'blocked';

export type ActorRole =
  | 'ai_agent'
  | 'support_agent'
  | 'manager'
  | 'finance'
  | 'admin';

export type ActionPolicy = {
  action: string;
  currency: string;
  version: number;
  autoExecute: {
    enabled: boolean;
    /** null means "no automatic execution by amount". */
    maxAmount: number | null;
    requiresEligibilityPass: boolean;
    requiresNoRiskFlags: boolean;
  };
  managerApproval: {
    enabled: boolean;
    /** Above this, a manager alone is not enough. null means no ceiling. */
    threshold: number | null;
  };
  restrictedConditions: string[];
};

/**
 * Conservative default. Amounts here are NOT a universal rule — every tenant
 * configures its own matrix (see §4: "INR 500 or INR 2,000 are examples only").
 */
export const DEFAULT_REFUND_POLICY: ActionPolicy = {
  action: 'refund',
  currency: 'INR',
  version: 1,
  autoExecute: {
    enabled: true,
    maxAmount: 500,
    requiresEligibilityPass: true,
    requiresNoRiskFlags: true,
  },
  managerApproval: { enabled: true, threshold: 10000 },
  restrictedConditions: [
    'duplicate_refund',
    'payment_dispute',
    'policy_exception',
    'bank_detail_change',
    'chargeback',
  ],
};

/** What each role is allowed to finally authorise. */
const ROLE_AUTHORITY: Record<ActorRole, ActionDecision[]> = {
  ai_agent: ['auto_execute'],
  support_agent: ['auto_execute'],
  manager: ['auto_execute', 'manager_approval'],
  finance: ['auto_execute', 'manager_approval', 'human_only'],
  admin: ['auto_execute', 'manager_approval', 'human_only'],
};

export function roleCanAuthorise(
  role: ActorRole,
  decision: ActionDecision,
): boolean {
  return (ROLE_AUTHORITY[role] ?? []).includes(decision);
}

export type EvaluateInput = {
  action: string;
  amount?: number | null;
  policy?: ActionPolicy;
  /** Deterministic eligibility result from the business rules, not the model. */
  eligibility?: { passed: boolean; failed?: string[] };
  /** Authorised, explainable risk signals only. */
  riskFlags?: string[];
  /** Case conditions such as duplicate_refund, payment_dispute. */
  conditions?: string[];
  /** Set when the caller explicitly asked for a human. */
  customerRequestedHuman?: boolean;
};

export type EvaluateResult = {
  decision: ActionDecision;
  riskLevel: RiskLevel;
  reasons: string[];
  policyVersion: number;
  requiresConfirmation: boolean;
};

export function evaluateAction(input: EvaluateInput): EvaluateResult {
  const policy = input.policy ?? DEFAULT_REFUND_POLICY;
  const reasons: string[] = [];
  const conditions = input.conditions ?? [];
  const riskFlags = input.riskFlags ?? [];
  const eligibility = input.eligibility ?? {
    passed: false,
    failed: ['unknown'],
  };
  const amount = typeof input.amount === 'number' ? input.amount : null;

  // 1. Restricted conditions are never automated and never manager-only.
  const restricted = conditions.filter((condition) =>
    policy.restrictedConditions.includes(condition),
  );
  if (restricted.length) {
    return {
      decision: 'human_only',
      riskLevel: 'restricted',
      reasons: [`restricted_condition:${restricted.join(',')}`],
      policyVersion: policy.version,
      requiresConfirmation: true,
    };
  }

  // 2. An explicit request for a human always wins.
  if (input.customerRequestedHuman) {
    return {
      decision: 'human_only',
      riskLevel: 'medium',
      reasons: ['customer_requested_human'],
      policyVersion: policy.version,
      requiresConfirmation: false,
    };
  }

  // 3. Deterministic eligibility must pass before anything automatic.
  if (!eligibility.passed) {
    reasons.push(
      `eligibility_failed:${(eligibility.failed ?? ['unspecified']).join(',')}`,
    );
    return {
      decision: policy.managerApproval.enabled
        ? 'manager_approval'
        : 'human_only',
      riskLevel: 'high',
      reasons,
      policyVersion: policy.version,
      requiresConfirmation: true,
    };
  }

  // 4. Risk flags block automation when the policy demands a clean case.
  if (riskFlags.length && policy.autoExecute.requiresNoRiskFlags) {
    reasons.push(`risk_flags:${riskFlags.join(',')}`);
    return {
      decision: policy.managerApproval.enabled
        ? 'manager_approval'
        : 'human_only',
      riskLevel: 'high',
      reasons,
      policyVersion: policy.version,
      requiresConfirmation: true,
    };
  }

  // 5. Amount is required for a money action.
  if (amount === null || !Number.isFinite(amount) || amount <= 0) {
    return {
      decision: 'manager_approval',
      riskLevel: 'high',
      reasons: ['amount_missing_or_invalid'],
      policyVersion: policy.version,
      requiresConfirmation: true,
    };
  }

  // 6. Within the tenant's AI authority → automatic.
  const autoCeiling = policy.autoExecute.maxAmount;
  if (
    policy.autoExecute.enabled &&
    autoCeiling !== null &&
    amount <= autoCeiling
  ) {
    return {
      decision: 'auto_execute',
      riskLevel: amount <= autoCeiling / 2 ? 'low' : 'medium',
      reasons: [`within_ai_authority:${autoCeiling}`],
      policyVersion: policy.version,
      requiresConfirmation: true,
    };
  }

  // 7. Above AI authority but within manager authority → approval card.
  const managerCeiling = policy.managerApproval.threshold;
  if (
    policy.managerApproval.enabled &&
    (managerCeiling === null || amount <= managerCeiling)
  ) {
    return {
      decision: 'manager_approval',
      riskLevel: 'high',
      reasons: [`above_ai_authority:${autoCeiling ?? 0}`],
      policyVersion: policy.version,
      requiresConfirmation: true,
    };
  }

  // 8. Above every delegated authority.
  return {
    decision: 'human_only',
    riskLevel: 'restricted',
    reasons: [`above_manager_threshold:${managerCeiling ?? 0}`],
    policyVersion: policy.version,
    requiresConfirmation: true,
  };
}
