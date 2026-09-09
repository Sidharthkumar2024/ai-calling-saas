/**
 * The sentence an admin reads after switching a workspace off and on.
 *
 * A suspension stops campaigns that are dialling people, and a reactivation
 * does not start them again. Both halves have to be said, and the plural has
 * to be right, because this is read once and acted on.
 */
import assert from 'node:assert/strict';

import {
  reactivationNote,
  suspensionNote,
} from '../lib/tenant-suspension.ts';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};

equal(
  suspensionNote({ campaignsPaused: 3, jobsCancelled: 12 }),
  'Suspended. Stopped 3 running campaigns and 12 queued jobs.',
);
equal(
  suspensionNote({ campaignsPaused: 1, jobsCancelled: 1 }),
  'Suspended. Stopped 1 running campaign and 1 queued job.',
);
// Only what actually happened is listed; a zero is not reported as a nothing
// with a number on it.
equal(
  suspensionNote({ campaignsPaused: 2, jobsCancelled: 0 }),
  'Suspended. Stopped 2 running campaigns.',
);
equal(
  suspensionNote({ campaignsPaused: 0, jobsCancelled: 4 }),
  'Suspended. Stopped 4 queued jobs.',
);
// A quiet workspace and a busy one are different acts and must not read alike.
equal(
  suspensionNote({ campaignsPaused: 0, jobsCancelled: 0 }),
  'Suspended. Nothing was running.',
);
equal(suspensionNote({ campaignsPaused: undefined, jobsCancelled: undefined }), 'Suspended. Nothing was running.');

// The half nobody could see: reactivation starts nothing.
ok(
  reactivationNote({ campaignsPaused: 3 }).includes(
    'will not start on their own',
  ),
);
equal(
  reactivationNote({ campaignsPaused: 1 }),
  'Back on. 1 campaign is paused and will not start on its own — somebody in the workspace has to start it.',
);
equal(
  reactivationNote({ campaignsPaused: 0 }),
  'Back on. No campaigns are waiting to be started.',
);
equal(
  reactivationNote({ campaignsPaused: undefined }),
  'Back on. No campaigns are waiting to be started.',
);
// A count that arrives as nonsense is not printed as NaN at somebody.
equal(
  reactivationNote({ campaignsPaused: 'many' }),
  'Back on. No campaigns are waiting to be started.',
);
equal(suspensionNote({ campaignsPaused: -2 }), 'Suspended. Nothing was running.');

console.log(`tenant suspension: ${checks} assertions passed.`);
