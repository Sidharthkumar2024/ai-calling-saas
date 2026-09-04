/**
 * API Health Center (§29).
 *
 * The admin health panel had two honest numbers — a timed D1 round trip and the
 * job-queue depth — and the rest was asserted: `api: 'operational'` was a
 * constant, and the voice gateway's "health" was whether an environment
 * variable was set. There were no last-success timestamps, no token expiry, no
 * webhook health, no quota and no circuit breakers, and the state vocabulary
 * was whatever each check happened to return.
 *
 * §29 names five states, and the fifth is the one that makes the other four
 * usable: **unknown**. A component nobody has called yet is not healthy, and
 * saying so is the difference between a dashboard and a decoration.
 *
 * Pure: every input is passed in, including the clock, so the thresholds are
 * testable and the same classification runs in a test and in production.
 */

export const HEALTH_STATES = [
  'healthy',
  'degraded',
  'unhealthy',
  'unknown',
  'maintenance',
] as const;

export type HealthState = (typeof HEALTH_STATES)[number];

export type HealthThresholds = {
  /** Error rate, as a fraction, above which a component is degraded. */
  degradedErrorRate: number;
  /** Error rate above which it is unhealthy. */
  unhealthyErrorRate: number;
  /** p95 latency in ms above which a component is degraded. */
  degradedLatencyMs: number;
  /** How long without a success before a component that had one is suspect. */
  staleAfterMs: number;
  /** Consecutive failures that trip the circuit breaker. */
  breakerFailures: number;
  /** How long the breaker stays open before allowing a trial call. */
  breakerCooldownMs: number;
};

export const DEFAULT_THRESHOLDS: HealthThresholds = {
  degradedErrorRate: 0.05,
  unhealthyErrorRate: 0.25,
  degradedLatencyMs: 4000,
  staleAfterMs: 6 * 60 * 60 * 1000,
  breakerFailures: 5,
  breakerCooldownMs: 60_000,
};

export type ServiceSample = {
  component: string;
  /** Calls in the measured window. */
  total: number;
  failures: number;
  p95LatencyMs?: number | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  consecutiveFailures?: number;
  /** When the circuit breaker tripped, if it is open. */
  openedAt?: string | null;
  /** Set while an operator has declared planned downtime. */
  maintenanceUntil?: string | null;
  /** Credential expiry, when the component uses one. */
  tokenExpiresAt?: string | null;
  quotaUsed?: number | null;
  quotaLimit?: number | null;
  /** False when the component has no credentials at all. */
  configured?: boolean;
};

export type ServiceHealth = {
  component: string;
  state: HealthState;
  /** One sentence an operator can act on. */
  reason: string;
  errorRate: number | null;
  p95LatencyMs: number | null;
  lastSuccessAt: string | null;
  /** Fraction of quota used, when a quota is known. */
  quotaUsedFraction: number | null;
  tokenState: TokenState;
  breaker: BreakerState;
};

export type TokenState = 'none' | 'valid' | 'expiring' | 'expired';

/**
 * Credential expiry. `expiring` exists so an OAuth token can be renewed before
 * it takes a service down rather than after.
 */
export function tokenState(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
  warnWithinMs = 7 * 24 * 60 * 60 * 1000,
): TokenState {
  if (!expiresAt) return 'none';
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return 'none';
  if (expiry <= now.getTime()) return 'expired';
  return expiry - now.getTime() <= warnWithinMs ? 'expiring' : 'valid';
}

export type BreakerState = 'closed' | 'open' | 'half_open';

/**
 * Circuit breaker state.
 *
 * `half_open` is the point of it: after the cooldown one trial call is allowed
 * through, so a recovered provider closes the breaker instead of staying shut
 * until someone notices. A breaker with no half-open state is just an outage
 * that needs a human.
 */
export function breakerState(
  input: {
    consecutiveFailures?: number;
    openedAt?: string | null;
    lastSuccessAt?: string | null;
  },
  thresholds: HealthThresholds = DEFAULT_THRESHOLDS,
  now: Date = new Date(),
): BreakerState {
  const failures = Number(input.consecutiveFailures ?? 0);
  const opened = input.openedAt ? Date.parse(input.openedAt) : Number.NaN;
  if (Number.isFinite(opened)) {
    const elapsed = now.getTime() - opened;
    if (elapsed < thresholds.breakerCooldownMs) return 'open';
    return 'half_open';
  }
  return failures >= thresholds.breakerFailures ? 'open' : 'closed';
}

/** Should a call to this component even be attempted right now? */
export function breakerAllowsCall(state: BreakerState) {
  return state !== 'open';
}

/**
 * Classifies one component.
 *
 * Order matters and is deliberate: a declared maintenance window wins over
 * everything, because a component someone took down on purpose is not an
 * incident. After that, "we have never heard from this" is `unknown` rather
 * than healthy — the failure mode the old panel had, where a provider nobody
 * had ever called reported `operational`.
 */
export function classifyService(
  sample: ServiceSample,
  thresholds: HealthThresholds = DEFAULT_THRESHOLDS,
  now: Date = new Date(),
): ServiceHealth {
  const breaker = breakerState(sample, thresholds, now);
  const token = tokenState(sample.tokenExpiresAt, now);
  const total = Number(sample.total ?? 0);
  const failures = Number(sample.failures ?? 0);
  const errorRate = total > 0 ? failures / total : null;
  const p95 = Number.isFinite(Number(sample.p95LatencyMs))
    ? Number(sample.p95LatencyMs)
    : null;
  const quotaUsedFraction =
    Number.isFinite(Number(sample.quotaLimit)) && Number(sample.quotaLimit) > 0
      ? Number(sample.quotaUsed ?? 0) / Number(sample.quotaLimit)
      : null;

  const base = {
    component: sample.component,
    errorRate,
    p95LatencyMs: p95,
    lastSuccessAt: sample.lastSuccessAt ?? null,
    quotaUsedFraction,
    tokenState: token,
    breaker,
  };

  if (sample.maintenanceUntil) {
    const until = Date.parse(sample.maintenanceUntil);
    if (Number.isFinite(until) && until > now.getTime())
      return {
        ...base,
        state: 'maintenance',
        reason: `Planned maintenance until ${new Date(until).toISOString()}.`,
      };
  }

  if (sample.configured === false)
    return {
      ...base,
      state: 'unknown',
      reason: 'No credentials are configured, so nothing has been measured.',
    };

  if (token === 'expired')
    return {
      ...base,
      state: 'unhealthy',
      reason:
        'The stored credential has expired; calls will fail until it is renewed.',
    };

  if (breaker === 'open')
    return {
      ...base,
      state: 'unhealthy',
      reason:
        'The circuit breaker is open after repeated failures; calls are being skipped.',
    };

  if (total === 0) {
    // Never called, or not called in this window. Either way there is nothing
    // to judge — and calling that "operational" is how a dashboard lies.
    if (!sample.lastSuccessAt)
      return {
        ...base,
        state: 'unknown',
        reason:
          'No calls have been recorded, so there is nothing to measure yet.',
      };
    const since = now.getTime() - Date.parse(sample.lastSuccessAt);
    if (Number.isFinite(since) && since > thresholds.staleAfterMs)
      return {
        ...base,
        state: 'unknown',
        reason: `No calls in this window; the last success was ${Math.round(since / 3_600_000)}h ago.`,
      };
    return {
      ...base,
      state: 'healthy',
      reason: 'No calls in this window, and the last one succeeded recently.',
    };
  }

  if (errorRate !== null && errorRate >= thresholds.unhealthyErrorRate)
    return {
      ...base,
      state: 'unhealthy',
      reason: `${Math.round(errorRate * 100)}% of calls failed.`,
    };

  const notes: string[] = [];
  if (errorRate !== null && errorRate >= thresholds.degradedErrorRate)
    notes.push(`${Math.round(errorRate * 100)}% of calls failed`);
  if (p95 !== null && p95 >= thresholds.degradedLatencyMs)
    notes.push(`p95 latency is ${p95} ms`);
  if (token === 'expiring') notes.push('the credential expires soon');
  if (quotaUsedFraction !== null && quotaUsedFraction >= 0.9)
    notes.push(`${Math.round(quotaUsedFraction * 100)}% of quota is used`);
  if (breaker === 'half_open')
    notes.push('the circuit breaker is testing recovery');

  if (notes.length)
    return {
      ...base,
      state: 'degraded',
      reason: `${notes.join('; ')}.`,
    };

  return {
    ...base,
    state: 'healthy',
    reason: 'Calls are succeeding within thresholds.',
  };
}

/**
 * The worst state across components, for a single headline.
 *
 * `unknown` deliberately ranks above `healthy`: a platform with an unmeasured
 * component is not known to be healthy, and rolling it up as green is the same
 * lie one component at a time.
 */
const SEVERITY: Record<HealthState, number> = {
  healthy: 0,
  maintenance: 1,
  unknown: 2,
  degraded: 3,
  unhealthy: 4,
};

export function rollUp(states: HealthState[]): HealthState {
  if (!states?.length) return 'unknown';
  return states.reduce((worst, state) =>
    SEVERITY[state] > SEVERITY[worst] ? state : worst,
  );
}
