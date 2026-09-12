/**
 * Which carrier a workspace dials through.
 *
 * Vaani resells Vobiz, so a workspace that has been given a Vobiz number
 * should dial through Vobiz without anyone setting a second switch. Everything
 * this choice reads is in `phone_numbers`, and every row below is one the
 * product can actually be in.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { chooseCarrier } from '../lib/carrier-router.ts';

let checks = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks += 1;
};

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`CREATE TABLE phone_numbers(
  id TEXT PRIMARY KEY, organization_id TEXT, phone_number TEXT, provider_code TEXT,
  status TEXT, direction TEXT, created_at TEXT);`);
const add = (row) =>
  sqlite
    .prepare('INSERT INTO phone_numbers VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(
      row.id,
      row.org,
      row.number,
      row.provider,
      row.status,
      row.direction ?? 'inbound_outbound',
      row.created ?? '2026-01-01T00:00:00Z',
    );

const db = {
  prepare(sql) {
    return {
      bind(...args) {
        return {
          async first() {
            return sqlite.prepare(sql).get(...args) ?? null;
          },
        };
      },
    };
  },
};

// Nothing configured at all: the carrier the customer brings, exactly as before
// Vobiz existed.
equal(await chooseCarrier(db, 'org_none'), {
  carrier: 'exotel',
  fromNumber: null,
});

// A live Vobiz number.
add({
  id: 'n1',
  org: 'org_1',
  number: '+911244982201',
  provider: 'vobiz',
  status: 'active',
});
equal(await chooseCarrier(db, 'org_1'), {
  carrier: 'vobiz',
  fromNumber: '+911244982201',
});

// A Vobiz number still in KYC is not a number to call from. Their API refuses a
// `from` the sub-account does not own, so dialling anyway turns a setup problem
// into a failed call the customer sees.
add({
  id: 'n2',
  org: 'org_2',
  number: '+911244982202',
  provider: 'vobiz',
  status: 'pending_verification',
});
equal(await chooseCarrier(db, 'org_2'), {
  carrier: 'exotel',
  fromNumber: null,
});

// An inbound-only number answers calls; it does not place them.
add({
  id: 'n3',
  org: 'org_3',
  number: '+911244982203',
  provider: 'vobiz',
  status: 'active',
  direction: 'inbound',
});
equal(await chooseCarrier(db, 'org_3'), {
  carrier: 'exotel',
  fromNumber: null,
});

// Somebody else's active Vobiz number is not this workspace's.
equal(await chooseCarrier(db, 'org_4'), {
  carrier: 'exotel',
  fromNumber: null,
});

// Two live numbers: the older one, every time, so the same workspace does not
// call from a different number on each dial.
add({
  id: 'n5',
  org: 'org_5',
  number: '+911244982299',
  provider: 'vobiz',
  status: 'active',
  created: '2026-05-01T00:00:00Z',
});
add({
  id: 'n4',
  org: 'org_5',
  number: '+911244982205',
  provider: 'vobiz',
  status: 'active',
  created: '2026-02-01T00:00:00Z',
});
equal(await chooseCarrier(db, 'org_5'), {
  carrier: 'vobiz',
  fromNumber: '+911244982205',
});

// An Exotel number stays on Exotel even though it is active and outbound.
add({
  id: 'n6',
  org: 'org_6',
  number: '+911244982206',
  provider: 'exotel',
  status: 'active',
});
equal(await chooseCarrier(db, 'org_6'), {
  carrier: 'exotel',
  fromNumber: null,
});

sqlite.close();
console.log(
  `carrier router: ${checks} assertions passed; no provider contacted.`,
);
