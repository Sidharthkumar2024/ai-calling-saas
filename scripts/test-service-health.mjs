import {
  DEFAULT_THRESHOLDS,
  HEALTH_STATES,
  breakerAllowsCall,
  breakerState,
  classifyService,
  rollUp,
  tokenState,
} from '../lib/service-health.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

const NOW = new Date('2026-09-04T12:00:00.000Z');
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms) => new Date(NOW.getTime() + ms).toISOString();
const s = (extra = {}) => ({ component: 'llm', total: 100, failures: 0, ...extra });

console.log('vocabulary:');
ok('the five §29 states exist', HEALTH_STATES.length === 5 && HEALTH_STATES.includes('maintenance'));

console.log('token expiry:');
ok('no expiry is not a problem', tokenState(null, NOW) === 'none');
ok('a far-off expiry is valid', tokenState(ahead(90 * 864e5), NOW) === 'valid');
ok('one inside the warning window is expiring', tokenState(ahead(3 * 864e5), NOW) === 'expiring');
ok('a past expiry is expired', tokenState(ago(1000), NOW) === 'expired');
ok('an unparseable expiry is not treated as expired', tokenState('soon', NOW) === 'none');

console.log('circuit breaker:');
ok('few failures keep it closed', breakerState({ consecutiveFailures: 2 }, DEFAULT_THRESHOLDS, NOW) === 'closed');
ok('enough failures open it', breakerState({ consecutiveFailures: 5 }, DEFAULT_THRESHOLDS, NOW) === 'open');
ok('it stays open during the cooldown', breakerState({ openedAt: ago(10_000) }, DEFAULT_THRESHOLDS, NOW) === 'open');
ok(
  'THE POINT OF IT: after the cooldown one trial call is allowed',
  breakerState({ openedAt: ago(120_000) }, DEFAULT_THRESHOLDS, NOW) === 'half_open',
);
ok('an open breaker blocks calls', !breakerAllowsCall('open'));
ok('a half-open one lets the trial through', breakerAllowsCall('half_open'));

console.log('classification:');
ok('clean traffic is healthy', classifyService(s(), DEFAULT_THRESHOLDS, NOW).state === 'healthy');
ok('6% failures is degraded', classifyService(s({ failures: 6 }), DEFAULT_THRESHOLDS, NOW).state === 'degraded');
ok('30% failures is unhealthy', classifyService(s({ failures: 30 }), DEFAULT_THRESHOLDS, NOW).state === 'unhealthy');
ok(
  'slow but succeeding is degraded, not healthy',
  classifyService(s({ p95LatencyMs: 9000 }), DEFAULT_THRESHOLDS, NOW).state === 'degraded',
);
ok(
  'the reason names the measurement',
  classifyService(s({ p95LatencyMs: 9000 }), DEFAULT_THRESHOLDS, NOW).reason.includes('9000 ms'),
);

console.log('the unknown state:');
const never = classifyService(s({ total: 0, failures: 0 }), DEFAULT_THRESHOLDS, NOW);
ok(
  'THE OLD LIE: a component nobody has called is unknown, not operational',
  never.state === 'unknown',
);
ok('and it says why', never.reason.includes('nothing to measure'));
ok(
  'unconfigured is unknown, not unhealthy — nothing is broken, nothing is set up',
  classifyService(s({ configured: false }), DEFAULT_THRESHOLDS, NOW).state === 'unknown',
);
ok(
  'quiet but recently successful is healthy',
  classifyService(s({ total: 0, lastSuccessAt: ago(60_000) }), DEFAULT_THRESHOLDS, NOW).state === 'healthy',
);
ok(
  'quiet for a long time goes back to unknown',
  classifyService(s({ total: 0, lastSuccessAt: ago(20 * 3600_000) }), DEFAULT_THRESHOLDS, NOW).state === 'unknown',
);

console.log('precedence:');
ok(
  'declared maintenance wins over failures — it is not an incident',
  classifyService(s({ failures: 90, maintenanceUntil: ahead(3600_000) }), DEFAULT_THRESHOLDS, NOW).state === 'maintenance',
);
ok(
  'an elapsed maintenance window stops applying',
  classifyService(s({ failures: 90, maintenanceUntil: ago(1000) }), DEFAULT_THRESHOLDS, NOW).state === 'unhealthy',
);
ok(
  'an expired credential is unhealthy even with no traffic',
  classifyService(s({ total: 0, tokenExpiresAt: ago(1000) }), DEFAULT_THRESHOLDS, NOW).state === 'unhealthy',
);
ok(
  'an open breaker is unhealthy even if the window looks clean',
  classifyService(s({ consecutiveFailures: 9 }), DEFAULT_THRESHOLDS, NOW).state === 'unhealthy',
);
ok(
  'an expiring credential degrades rather than breaking',
  classifyService(s({ tokenExpiresAt: ahead(864e5) }), DEFAULT_THRESHOLDS, NOW).state === 'degraded',
);
ok(
  'quota near its limit degrades',
  classifyService(s({ quotaUsed: 95, quotaLimit: 100 }), DEFAULT_THRESHOLDS, NOW).state === 'degraded',
);
ok(
  'quota well inside the limit does not',
  classifyService(s({ quotaUsed: 10, quotaLimit: 100 }), DEFAULT_THRESHOLDS, NOW).state === 'healthy',
);

console.log('roll-up:');
ok('all healthy rolls up healthy', rollUp(['healthy', 'healthy']) === 'healthy');
ok('the worst state wins', rollUp(['healthy', 'degraded', 'unhealthy']) === 'unhealthy');
ok(
  'UNKNOWN OUTRANKS HEALTHY: an unmeasured component is not a green platform',
  rollUp(['healthy', 'unknown']) === 'unknown',
);
ok('maintenance does not mask a real failure', rollUp(['maintenance', 'unhealthy']) === 'unhealthy');
ok('maintenance alone is not an incident', rollUp(['healthy', 'maintenance']) === 'maintenance');
ok('nothing at all is unknown', rollUp([]) === 'unknown');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
