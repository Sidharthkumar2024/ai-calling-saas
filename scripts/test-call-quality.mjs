import {
  evaluateReadiness,
  jitterOf,
  medianOf,
  scoreQuality,
  supportCode,
} from '../lib/call-quality.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

const clean = { rtts: [40, 42, 41, 39, 40], lossRatio: 0, micLevel: 0.3 };

console.log('statistics:');
ok('median of an odd list', medianOf([5, 1, 3]) === 3);
ok('median of an even list averages the middle', medianOf([1, 2, 3, 4]) === 2.5);
ok('median of nothing is zero, not NaN', medianOf([]) === 0);
ok('jitter of a steady line is zero', jitterOf([40, 40, 40]) === 0);
ok('jitter grows with variation', jitterOf([10, 60, 10]) === 50);
ok('a single sample has no jitter', jitterOf([40]) === 0);

console.log('scoring:');
ok(
  'a clean connection scores excellent',
  (() => {
    const v = scoreQuality(clean);
    return v.band === 'excellent' && v.score === 100 && v.warnings.length === 0;
  })(),
);
ok(
  'high latency drops the band and names itself',
  (() => {
    const v = scoreQuality({ ...clean, rtts: [260, 265, 258] });
    return v.band === 'good' && v.primaryIssue === 'rtt_high';
  })(),
);
ok(
  'severe latency reads poor',
  scoreQuality({ ...clean, rtts: [500, 520, 510] }).band === 'fair' ||
    scoreQuality({ ...clean, rtts: [500, 520, 510] }).band === 'poor',
);
ok(
  'jitter alone is caught',
  (() => {
    const v = scoreQuality({ ...clean, rtts: [40, 130, 45, 140, 42] });
    return v.warnings.some((w) => w.code.startsWith('jitter'));
  })(),
);
ok(
  'packet loss is reported as a percentage',
  (() => {
    const v = scoreQuality({ ...clean, lossRatio: 0.08 });
    return v.lossPercent === 8 && v.primaryIssue === 'loss_severe';
  })(),
);
ok(
  'the worst metric wins when several are bad',
  (() => {
    const v = scoreQuality({
      rtts: [250, 255],
      lossRatio: 0.09,
      micLevel: 0.3,
    });
    return v.primaryIssue === 'loss_severe';
  })(),
);
ok(
  'no samples at all is reported, not scored as perfect',
  (() => {
    const v = scoreQuality({ rtts: [], lossRatio: 0 });
    return v.score === 0 && v.primaryIssue === 'no_samples';
  })(),
);
ok('the score never goes below zero', scoreQuality({ rtts: [900, 950], lossRatio: 1, micLevel: 0 }).score === 0);

console.log('microphone level:');
ok(
  'silence is the loudest complaint',
  scoreQuality({ ...clean, micLevel: 0 }).primaryIssue === 'mic_silent',
);
ok(
  'a quiet mic warns without blocking the score entirely',
  (() => {
    const v = scoreQuality({ ...clean, micLevel: 0.01 });
    return v.primaryIssue === 'mic_quiet' && v.score === 80;
  })(),
);
ok(
  'clipping is caught at the top end',
  scoreQuality({ ...clean, micLevel: 0.98 }).primaryIssue === 'mic_clipping',
);
ok(
  'an unmeasured mic is not penalised',
  scoreQuality({ ...clean, micLevel: null }).score === 100,
);

console.log('readiness gate:');
const base = {
  microphonePermission: 'granted',
  hasInputDevice: true,
  micLevel: 0.3,
  quality: scoreQuality(clean),
};
ok('a good setup is ready', evaluateReadiness(base).state === 'ready');
ok(
  'denied permission blocks, with the fix',
  (() => {
    const r = evaluateReadiness({ ...base, microphonePermission: 'denied' });
    return r.state === 'blocked' && /site settings/i.test(r.reasons[0]);
  })(),
);
ok(
  'an unsupported browser blocks',
  evaluateReadiness({ ...base, microphonePermission: 'unsupported' }).state ===
    'blocked',
);
ok(
  'no microphone blocks',
  evaluateReadiness({ ...base, hasInputDevice: false }).state === 'blocked',
);
ok(
  'a silent microphone blocks',
  evaluateReadiness({ ...base, micLevel: 0 }).state === 'blocked',
);
ok(
  'a poor connection blocks going available',
  evaluateReadiness({
    ...base,
    quality: scoreQuality({ rtts: [600, 610], lossRatio: 0.2, micLevel: 0.3 }),
  }).state === 'blocked',
);
ok(
  'a fair connection warns rather than blocking',
  (() => {
    const r = evaluateReadiness({
      ...base,
      quality: scoreQuality({ rtts: [250, 255], lossRatio: 0.02, micLevel: 0.3 }),
    });
    return r.state === 'warn' && r.reasons.length > 0;
  })(),
);
ok(
  'an unmeasured connection warns, never silently passes',
  (() => {
    const r = evaluateReadiness({ ...base, quality: null });
    return r.state === 'warn' && /not been measured/i.test(r.reasons[0]);
  })(),
);
ok(
  'a pending permission prompt blocks until answered',
  evaluateReadiness({ ...base, microphonePermission: 'prompt' }).state ===
    'blocked',
);

console.log('support code:');
ok(
  'the code is stable for the same seed',
  supportCode('abc') === supportCode('abc'),
);
ok('different seeds differ', supportCode('abc') !== supportCode('abd'));
ok(
  'the format is readable and avoids ambiguous characters',
  /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/.test(supportCode('anything')),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
