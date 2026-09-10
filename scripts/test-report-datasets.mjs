/**
 * Which data a scheduled report is about.
 *
 * The failure this pins down is not an exception anywhere — it is a CSV of the
 * wrong table arriving under the right name. Every type the screen offers has
 * to resolve to something, and a name that resolves to nothing has to say so
 * rather than fall through to whatever the builder happened to end with.
 */
import assert from 'node:assert/strict';

import {
  REPORT_TYPES,
  datasetFor,
  isReportType,
  unknownReportMessage,
} from '../lib/report-datasets.ts';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};
const ok = (value, message) => {
  assert.ok(value, message);
  checks += 1;
};

// THE ONE THAT WAS BROKEN. Every type the creator screen offers resolves, and
// none of them resolves to calls-by-accident.
equal(datasetFor('call_performance'), 'calls');
equal(datasetFor('agent_productivity'), 'agents');
equal(datasetFor('lead_conversion'), 'leads');
equal(datasetFor('campaign_outcomes'), 'campaigns');
equal(datasetFor('spend'), 'usage');
for (const type of REPORT_TYPES)
  ok(datasetFor(type), `${type} resolves to a dataset`);

// The three the builder used to branch on are reachable from an API client and
// from rows written before the screen existed.
equal(datasetFor('leads'), 'leads');
equal(datasetFor('conversion'), 'leads');
equal(datasetFor('cost'), 'usage');
equal(datasetFor('usage'), 'usage');
equal(datasetFor('qa'), 'quality');
equal(datasetFor('quality'), 'quality');
// The seeded demo report was created with this one.
equal(datasetFor('operations'), 'calls');

// Case and stray spacing are not a different report.
equal(datasetFor('  Lead_Conversion '), 'leads');

// A name nothing can be built from resolves to nothing — not to calls.
equal(datasetFor('quarterly_board_pack'), null);
equal(datasetFor(''), null);
equal(datasetFor(undefined), null);
equal(datasetFor(null), null);
ok(
  unknownReportMessage('quarterly_board_pack').includes('quarterly_board_pack'),
  'and the failure names the type, so the report can be edited',
);

// The creator only accepts what it offers.
ok(isReportType('spend'));
ok(!isReportType('cost'), 'a legacy alias still resolves but is not offered');
ok(!isReportType('quarterly_board_pack'));
ok(!isReportType(''));

console.log(`report datasets: ${checks} assertions passed.`);
