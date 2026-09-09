import assert from 'node:assert/strict';

import {
  BEHIND_AFTER_MS,
  STALLED_AFTER_MS,
  queueVerdict,
} from '../lib/queue-health.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

const NOW = Date.parse('2026-09-09T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
/** The shape SQLite writes: UTC with no zone marker. */
const sqliteAgo = (ms) => new Date(NOW - ms).toISOString().slice(0, 19).replace('T', ' ');

const verdict = (facts) =>
  queueVerdict({ waiting: 0, oldestWaitingAt: null, lastCompletedAt: null, dead: 0, ...facts }, NOW);

// --- nothing waiting -------------------------------------------------------------

check(() => assert.equal(verdict({}).state, 'unknown'));
check(() => assert.match(verdict({}).reason, /Nothing has been queued yet/));
// An empty queue is the normal resting state and says nothing about whether
// the worker still runs. Claiming it healthy *because* it is empty would be
// the same lie in the other direction, so the sentence states the fact only.
check(() => assert.equal(verdict({ lastCompletedAt: ago(2 * 3_600_000) }).state, 'healthy'));
check(() =>
  assert.match(verdict({ lastCompletedAt: ago(2 * 3_600_000) }).reason, /Nothing is waiting/),
);

// --- the failure this exists for --------------------------------------------------

// Three days of dead cron: hundreds of old completions, two hundred jobs
// waiting. Judged on lifetime success rate this scored ~0% errors and reported
// healthy, while nothing in the product was running.
const deadCron = verdict({
  waiting: 200,
  oldestWaitingAt: ago(3 * 86_400_000),
  lastCompletedAt: ago(3 * 86_400_000),
});
check(() => assert.equal(deadCron.state, 'unhealthy'));
check(() => assert.match(deadCron.reason, /200 jobs are waiting/));
check(() => assert.match(deadCron.reason, /not dialled/));
check(() => assert.match(deadCron.reason, /api\/internal\/jobs/));

// Work waiting and nothing ever completed at all.
check(() =>
  assert.equal(verdict({ waiting: 4, oldestWaitingAt: ago(60_000) }).state, 'unhealthy'),
);
check(() =>
  assert.match(verdict({ waiting: 4, oldestWaitingAt: ago(60_000) }).reason, /at all/),
);

// --- draining ----------------------------------------------------------------------

// Busy is not broken: a backlog with recent completions is a queue doing its job.
const busy = verdict({
  waiting: 300,
  oldestWaitingAt: ago(30_000),
  lastCompletedAt: ago(2_000),
});
check(() => assert.equal(busy.state, 'healthy'));
check(() => assert.match(busy.reason, /being drained/));

// Running but not keeping up is neither healthy nor a stopped scheduler, and
// saying "not running" there would send somebody to check the wrong thing.
const behind = verdict({
  waiting: 50,
  oldestWaitingAt: ago(STALLED_AFTER_MS + 60_000),
  lastCompletedAt: ago(30_000),
});
check(() => assert.equal(behind.state, 'degraded'));
check(() => assert.match(behind.reason, /running but not keeping up/));

const wayBehind = verdict({
  waiting: 50,
  oldestWaitingAt: ago(BEHIND_AFTER_MS + 60_000),
  lastCompletedAt: ago(30_000),
});
check(() => assert.equal(wayBehind.state, 'unhealthy'));

// Jobs that gave up are worth saying even while the queue drains.
const withDead = verdict({
  waiting: 3,
  oldestWaitingAt: ago(5_000),
  lastCompletedAt: ago(1_000),
  dead: 7,
});
check(() => assert.equal(withDead.state, 'degraded'));
check(() => assert.match(withDead.reason, /7 jobs have given up/));
check(() =>
  assert.match(
    verdict({ waiting: 1, oldestWaitingAt: ago(5_000), lastCompletedAt: ago(1_000), dead: 1 }).reason,
    /1 job has given up/,
  ),
);

// --- reading the clock --------------------------------------------------------------

// SQLite writes UTC with no zone marker. Read as local time it is hours out,
// which here would invent a stall or hide one.
check(() => {
  const parsed = verdict({
    waiting: 2,
    oldestWaitingAt: sqliteAgo(60_000),
    lastCompletedAt: sqliteAgo(30_000),
  });
  assert.equal(parsed.state, 'healthy');
  assert.ok(parsed.idleMs >= 29_000 && parsed.idleMs <= 31_000);
});
// An unreadable timestamp is not a fresh one.
check(() =>
  assert.equal(
    verdict({ waiting: 2, oldestWaitingAt: ago(60_000), lastCompletedAt: 'not a date' }).state,
    'unhealthy',
  ),
);
// A clock that ran backwards must not read as work from the future.
check(() =>
  assert.equal(
    verdict({ waiting: 1, oldestWaitingAt: ago(-60_000), lastCompletedAt: ago(-60_000) }).waitedMs,
    0,
  ),
);

// --- how long, in words -------------------------------------------------------------

check(() =>
  assert.match(
    verdict({ waiting: 1, oldestWaitingAt: ago(90 * 60_000), lastCompletedAt: ago(30_000) }).reason,
    /2 hours/,
  ),
);
check(() =>
  assert.match(
    verdict({ waiting: 1, oldestWaitingAt: ago(20 * 60_000), lastCompletedAt: ago(30_000) }).reason,
    /20 minutes/,
  ),
);
check(() =>
  assert.match(
    verdict({ waiting: 1, oldestWaitingAt: ago(5 * 86_400_000), lastCompletedAt: ago(5 * 86_400_000) })
      .reason,
    /5 days/,
  ),
);

console.log(`queue health: ${checks} assertions passed`);
