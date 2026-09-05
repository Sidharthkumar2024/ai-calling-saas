import assert from 'node:assert/strict';

import {
  ARCHIVE,
  canArchive,
  canRestore,
  CONFIG_STATUSES,
  describeConfigRow,
  describeReferences,
  isConfigStatus,
  isOrgConfigKind,
  normaliseConfigStatus,
  ORG_CONFIG_KINDS,
  ORG_CONFIG_LABEL,
  ORG_CONFIG_TABLE,
  READ,
  RESTORE,
} from '../lib/org-config.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

check(() => assert.equal(ORG_CONFIG_KINDS.length, 7));
check(() => assert.equal(isOrgConfigKind('team'), true));
check(() => assert.equal(isOrgConfigKind('records'), false));

// Every kind maps to a table and a readable label, so no request can name a
// table and nothing renders a bare kind key at a person.
check(() =>
  assert.deepEqual(
    ORG_CONFIG_KINDS.filter((kind) => !ORG_CONFIG_TABLE[kind]),
    [],
  ),
);
check(() =>
  assert.deepEqual(
    ORG_CONFIG_KINDS.filter((kind) => !ORG_CONFIG_LABEL[kind]),
    [],
  ),
);
// The table names are interpolated into SQL, so they must be plain identifiers.
check(() =>
  assert.deepEqual(
    Object.values(ORG_CONFIG_TABLE).filter((table) => !/^[a-z_]+$/.test(table)),
    [],
  ),
);

check(() => assert.equal(CONFIG_STATUSES.length, 2));
check(() => assert.equal(isConfigStatus('archived'), true));
check(() => assert.equal(isConfigStatus('deleted'), false));

// The rows that exist today hold 'active', but plenty hold whatever a seed
// wrote. Anything unrecognised reads as active, so nothing vanishes from a
// screen because of a value nobody expected.
check(() => assert.equal(normaliseConfigStatus('active'), 'active'));
check(() => assert.equal(normaliseConfigStatus('archived'), 'archived'));
check(() => assert.equal(normaliseConfigStatus('enabled'), 'active'));
check(() => assert.equal(normaliseConfigStatus(null), 'active'));
check(() => assert.equal(normaliseConfigStatus(undefined), 'active'));

check(() => assert.equal(canArchive('active'), true));
check(() => assert.equal(canArchive('archived'), false));
check(() => assert.equal(canRestore('archived'), true));
check(() => assert.equal(canRestore('active'), false));
// Both directions, so archiving is never a one-way door.
check(() => assert.equal(canArchive(null), true));
check(() => assert.equal(canRestore(null), false));

// Archiving is allowed with references outstanding — that is the point of it —
// but the person doing it is told what they are.
check(() =>
  assert.match(
    describeReferences('team', { agent: 3 }),
    /3 agents still point at this team/,
  ),
);
check(() =>
  assert.match(
    describeReferences('team', { agent: 1 }),
    /1 agent still points/,
  ),
);
check(() =>
  assert.match(
    describeReferences('branch', { agent: 0, team: 0 }),
    /Nothing points at this branch/,
  ),
);
check(() =>
  assert.match(
    describeReferences('branch', { team: 2, agent: 5 }),
    /2 teams and 5 agents/,
  ),
);
// Said out loud, because it is the reason archiving beats deleting.
check(() =>
  assert.match(
    describeReferences('branch', { team: 2 }),
    /name stays readable on old records/,
  ),
);

check(() =>
  assert.equal(
    describeConfigRow({ kind: 'branch', name: 'Andheri', status: 'active' }),
    'Andheri',
  ),
);
check(() =>
  assert.match(
    describeConfigRow({ kind: 'branch', name: 'Andheri', status: 'archived' }),
    /Andheri — archived, kept for the records that mention it\./,
  ),
);
check(() =>
  assert.match(
    describeConfigRow({ kind: 'team', name: '  ', status: 'active' }),
    /Unnamed/,
  ),
);

// --- the statements ------------------------------------------------------

// These are handed to `.prepare()` from a map, so `check-sql-bindings` cannot
// see their placeholders the way it sees an inline statement. This is that
// guarantee, restored: every one takes exactly the id and the organization the
// service binds, in that order.
const STATEMENT_MAPS = { READ, ARCHIVE, RESTORE };
for (const name of Object.keys(STATEMENT_MAPS)) {
  const map = STATEMENT_MAPS[name];
  check(() =>
    assert.deepEqual(
      ORG_CONFIG_KINDS.filter((kind) => !map[kind]),
      [],
      `${name} is missing a kind`,
    ),
  );
  check(() =>
    assert.deepEqual(
      ORG_CONFIG_KINDS.filter(
        (kind) => (map[kind].match(/\?/g) || []).length !== 2,
      ),
      [],
      `${name} has a statement that does not take exactly two bindings`,
    ),
  );
  // Every statement is scoped to one workspace. A missing organization clause
  // here would archive another tenant's branch by id.
  check(() =>
    assert.deepEqual(
      ORG_CONFIG_KINDS.filter(
        (kind) => !/WHERE id = \? AND organization_id = \?/.test(map[kind]),
      ),
      [],
      `${name} has a statement that is not scoped to the workspace`,
    ),
  );
  // And touches the table its kind maps to, not a neighbour's.
  check(() =>
    assert.deepEqual(
      ORG_CONFIG_KINDS.filter(
        (kind) => !map[kind].includes(` ${ORG_CONFIG_TABLE[kind]} `),
      ),
      [],
      `${name} has a statement pointed at the wrong table`,
    ),
  );
}

check(() =>
  assert.deepEqual(
    ORG_CONFIG_KINDS.filter((kind) => !ARCHIVE[kind].includes("'archived'")),
    [],
  ),
);
check(() =>
  assert.deepEqual(
    ORG_CONFIG_KINDS.filter((kind) => !RESTORE[kind].includes("'active'")),
    [],
  ),
);

console.log(`org-config: ${checks} assertions passed`);
