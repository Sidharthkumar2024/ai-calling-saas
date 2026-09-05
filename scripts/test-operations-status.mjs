import assert from 'node:assert/strict';

import {
  ALERT_RULE_STATUSES,
  canMoveGraph,
  GRAPH_ACTION_LABEL,
  GRAPH_AGENT_STATUSES,
  isAlertRuleStatus,
  isGraphAgentStatus,
  nextGraphStatuses,
  normaliseAlertStatus,
  toggleAlertStatus,
} from '../lib/operations-status.ts';
import {
  canMoveQuality,
  isQualityStatus,
  nextQualityStatuses,
  normaliseQualityStatus,
  openFindings,
  QUALITY_STATUSES,
} from '../lib/call-quality.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

// --- alert rules -------------------------------------------------------------

check(() => assert.equal(ALERT_RULE_STATUSES.length, 2));
check(() => assert.equal(isAlertRuleStatus('disabled'), true));
check(() => assert.equal(isAlertRuleStatus('paused'), false));
// A rule with an unexpected value keeps firing rather than going quiet — the
// failure that matters here is an alert nobody gets.
check(() => assert.equal(normaliseAlertStatus('enabled'), 'active'));
check(() => assert.equal(normaliseAlertStatus(null), 'active'));
check(() => assert.equal(normaliseAlertStatus('disabled'), 'disabled'));
check(() => assert.equal(toggleAlertStatus('active'), 'disabled'));
check(() => assert.equal(toggleAlertStatus('disabled'), 'active'));
check(() => assert.equal(toggleAlertStatus(undefined), 'disabled'));

// --- graph agents ------------------------------------------------------------

check(() => assert.equal(GRAPH_AGENT_STATUSES.length, 4));
check(() => assert.equal(isGraphAgentStatus('published'), true));
check(() => assert.equal(isGraphAgentStatus('live'), false));

check(() =>
  assert.deepEqual(nextGraphStatuses('draft'), ['published', 'archived']),
);
check(() =>
  assert.deepEqual(nextGraphStatuses('published'), ['paused', 'archived']),
);
check(() =>
  assert.deepEqual(nextGraphStatuses('paused'), ['published', 'archived']),
);
// Archived is terminal. A graph worth using again is worth copying, so the
// record of what was live when a call happened stays true.
check(() => assert.deepEqual(nextGraphStatuses('archived'), []));
// A row seeded before these states existed holds 'active'. Leaving it with no
// moves at all would make it unmanageable, which is worse than mislabelled.
check(() =>
  assert.deepEqual(nextGraphStatuses('active'), ['published', 'archived']),
);
check(() =>
  assert.deepEqual(nextGraphStatuses('nonsense'), ['published', 'archived']),
);

check(() => assert.equal(canMoveGraph('draft', 'published'), true));
check(() => assert.equal(canMoveGraph('draft', 'paused'), false));
check(() => assert.equal(canMoveGraph('archived', 'published'), false));

check(() =>
  assert.deepEqual(
    GRAPH_AGENT_STATUSES.filter((status) => !GRAPH_ACTION_LABEL[status]),
    [],
  ),
);

// --- quality reviews ---------------------------------------------------------

check(() => assert.equal(QUALITY_STATUSES.length, 4));
check(() => assert.equal(isQualityStatus('dismissed'), true));
check(() => assert.equal(isQualityStatus('closed'), false));

check(() =>
  assert.deepEqual(nextQualityStatuses('needs_review'), [
    'reviewed',
    'dismissed',
  ]),
);
// The machine's own verdict stays put. Letting a person mark a passed call
// "reviewed" would make the open-findings count mean nothing.
check(() => assert.deepEqual(nextQualityStatuses('passed'), []));
check(() => assert.deepEqual(nextQualityStatuses('reviewed'), []));
check(() => assert.deepEqual(nextQualityStatuses('dismissed'), []));
check(() => assert.equal(canMoveQuality('needs_review', 'reviewed'), true));
check(() => assert.equal(canMoveQuality('passed', 'dismissed'), false));

// "Open" means still asking for a person — not merely "not passed", which is
// what the screen counted and which never went down.
check(() =>
  assert.equal(
    openFindings([
      { status: 'needs_review' },
      { status: 'reviewed' },
      { status: 'dismissed' },
      { status: 'passed' },
      { status: 'needs_review' },
    ]),
    2,
  ),
);
check(() => assert.equal(openFindings([]), 0));

// The demo seed holds a review whose status is the older word `review`, and a
// status nobody recognises must not leave a flagged call with no way to close
// it — so it counts as open and gets the same two answers.
check(() => assert.equal(normaliseQualityStatus('review'), 'needs_review'));
check(() => assert.equal(normaliseQualityStatus(null), 'needs_review'));
check(() => assert.equal(normaliseQualityStatus('passed'), 'passed'));
check(() => assert.equal(normaliseQualityStatus('dismissed'), 'dismissed'));
check(() =>
  assert.deepEqual(nextQualityStatuses('review'), ['reviewed', 'dismissed']),
);
check(() =>
  assert.equal(openFindings([{ status: 'review' }, { status: null }]), 2),
);

console.log(`operations-status: ${checks} assertions passed`);
