import assert from 'node:assert/strict';

import {
  analyticsObservations,
  authorizeUrl,
  CONNECTORS,
  CONNECTOR_IDS,
  connectorStatus,
  hubspotObservations,
  isConnectorId,
  needsRefresh,
  searchObservations,
} from '../lib/growth-connectors.ts';
import { MIN_SAMPLE } from '../lib/growth-manager.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const NOW = new Date('2026-09-05T10:00:00Z');

console.log('the catalogue');

check('all three connectors are defined and self-describing', () => {
  assert.equal(CONNECTOR_IDS.length, 3);
  for (const id of CONNECTOR_IDS) {
    const connector = CONNECTORS[id];
    assert.equal(connector.id, id);
    assert.ok(connector.scopes.length > 0, id);
    assert.ok(connector.answers.length > 20, id);
  }
});

check('unknown ids are refused rather than coerced', () => {
  assert.equal(isConnectorId('google_analytics'), true);
  assert.equal(isConnectorId('google'), false);
  assert.equal(isConnectorId(null), false);
});

check('only the Google connectors need something chosen afterwards', () => {
  assert.equal(CONNECTORS.google_analytics.needsSelection, true);
  assert.equal(CONNECTORS.search_console.needsSelection, true);
  // HubSpot's token is already scoped to one portal.
  assert.equal(CONNECTORS.hubspot.needsSelection, false);
});

console.log('\nthe authorise URL');

check('the scopes, redirect and state are all carried', () => {
  const url = new URL(
    authorizeUrl({
      connector: CONNECTORS.google_analytics,
      clientId: 'client-123',
      redirectUri: 'https://vaani.test/api/growth-oauth/callback?connector=google_analytics',
      state: 'st_abc',
    }),
  );
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), 'client-123');
  assert.equal(url.searchParams.get('state'), 'st_abc');
  assert.equal(
    url.searchParams.get('scope'),
    'https://www.googleapis.com/auth/analytics.readonly',
  );
});

check('Google gets access_type=offline AND prompt=consent', () => {
  // Without both, a repeat authorisation returns no refresh token and the
  // connector silently dies a week later.
  const url = new URL(
    authorizeUrl({
      connector: CONNECTORS.search_console,
      clientId: 'c',
      redirectUri: 'https://vaani.test/cb',
      state: 's',
    }),
  );
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
});

check('PKCE is included when a challenge is supplied, and omitted when not', () => {
  const withPkce = new URL(
    authorizeUrl({
      connector: CONNECTORS.google_analytics,
      clientId: 'c',
      redirectUri: 'r',
      state: 's',
      codeChallenge: 'chal',
    }),
  );
  assert.equal(withPkce.searchParams.get('code_challenge_method'), 'S256');
  const without = new URL(
    authorizeUrl({ connector: CONNECTORS.google_analytics, clientId: 'c', redirectUri: 'r', state: 's' }),
  );
  assert.equal(without.searchParams.get('code_challenge'), null);
});

check('HubSpot does not get Google’s parameters', () => {
  const url = new URL(
    authorizeUrl({ connector: CONNECTORS.hubspot, clientId: 'c', redirectUri: 'r', state: 's' }),
  );
  assert.equal(url.searchParams.get('access_type'), null);
  assert.equal(url.origin, 'https://app.hubspot.com');
});

console.log('\nstate — authorised is not connected');

const status = (overrides = {}) =>
  connectorStatus({
    connector: CONNECTORS.google_analytics,
    platformReady: true,
    connection: null,
    now: NOW,
    ...overrides,
  });

check('with no platform app, the message names whose problem it is', () => {
  // A generic "unavailable" sends a customer hunting for a setting they do not
  // have; the OAuth app belongs to the platform.
  const result = status({ platformReady: false });
  assert.equal(result.state, 'platform_not_configured');
  assert.match(result.message, /platform administrator/);
  assert.equal(result.canConnect, false);
});

check('unconnected says what connecting would answer', () => {
  const result = status();
  assert.equal(result.state, 'not_connected');
  assert.match(result.message, /How many people reach your site/);
  assert.equal(result.canConnect, true);
});

check('authorised with nothing chosen is its own state', () => {
  // The state that stops the connector reporting another business's numbers.
  const result = status({
    connection: {
      hasToken: true,
      selection: null,
      expiresAt: null,
      hasRefreshToken: true,
      lastSyncedAt: null,
    },
  });
  assert.equal(result.state, 'needs_selection');
  assert.match(result.message, /Nothing is read until you pick one/);
});

check('HubSpot skips that state, because there is nothing to choose', () => {
  const result = connectorStatus({
    connector: CONNECTORS.hubspot,
    platformReady: true,
    connection: {
      hasToken: true,
      selection: null,
      expiresAt: null,
      hasRefreshToken: true,
      lastSyncedAt: null,
    },
    now: NOW,
  });
  assert.equal(result.state, 'connected');
});

check('an expired token with no refresh token is expired, not connected', () => {
  const result = status({
    connection: {
      hasToken: true,
      selection: 'properties/1',
      expiresAt: '2026-09-04T10:00:00Z',
      hasRefreshToken: false,
      lastSyncedAt: null,
    },
  });
  assert.equal(result.state, 'expired');
});

check('an expired token WITH a refresh token is still connected', () => {
  const result = status({
    connection: {
      hasToken: true,
      selection: 'properties/1',
      expiresAt: '2026-09-04T10:00:00Z',
      hasRefreshToken: true,
      lastSyncedAt: null,
    },
  });
  assert.equal(result.state, 'connected');
});

check('connected but never read says so rather than implying data', () => {
  const result = status({
    connection: {
      hasToken: true,
      selection: 'properties/1',
      expiresAt: null,
      hasRefreshToken: true,
      lastSyncedAt: null,
    },
  });
  assert.match(result.message, /Nothing has been read yet/);
});

console.log('\nrefreshing');

check('a token expiring within the minute is refreshed first', () => {
  // A token that expires mid-request is a failure nobody can explain later.
  assert.equal(needsRefresh('2026-09-05T10:00:30Z', NOW), true);
  assert.equal(needsRefresh('2026-09-05T11:00:00Z', NOW), false);
});

check('no expiry means no refresh, an unreadable one means refresh', () => {
  assert.equal(needsRefresh(null, NOW), false);
  assert.equal(needsRefresh('whenever', NOW), true);
});

console.log('\nGoogle Analytics becomes evidence');

const gaRow = (channel, sessions) => ({
  dimensionValues: [{ value: channel }],
  metricValues: [{ value: String(sessions) }],
});

check('sessions and the top channel both carry the session count as sample', () => {
  const observations = analyticsObservations({
    rows: [gaRow('Organic Search', 300), gaRow('Direct', 100)],
    windowDays: 28,
  });
  const sessions = observations.find((entry) => entry.id === 'ga_sessions');
  assert.equal(sessions.metric.value, 400);
  assert.equal(sessions.sampleSize, 400);
  assert.equal(sessions.source, 'google_analytics');
  const top = observations.find((entry) => entry.id === 'ga_top_channel');
  assert.equal(top.metric.value, 75);
  assert.match(top.statement, /Organic Search/);
});

check('too few sessions produce nothing at all, not a shaky claim', () => {
  const observations = analyticsObservations({
    rows: [gaRow('Direct', MIN_SAMPLE - 1)],
    windowDays: 28,
  });
  assert.deepEqual(observations, []);
});

check('an empty property is empty, not zero-percent-of-nothing', () => {
  assert.deepEqual(analyticsObservations({ rows: [], windowDays: 28 }), []);
  assert.deepEqual(
    analyticsObservations({ rows: [gaRow('Direct', 0)], windowDays: 28 }),
    [],
  );
});

console.log('\nSearch Console becomes evidence');

check('click-through is computed from impressions, which are the sample', () => {
  const observations = searchObservations({
    rows: [
      { keys: ['2 bhk gurgaon'], clicks: 20, impressions: 1000, position: 4 },
      { keys: ['flats near me'], clicks: 5, impressions: 500, position: 22 },
    ],
    windowDays: 28,
  });
  const reach = observations.find((entry) => entry.id === 'gsc_impressions');
  assert.equal(reach.sampleSize, 1500);
  assert.match(reach.statement, /clicked 25 times/);
  assert.equal(reach.source, 'search_console');
});

check('the buried query is the most-shown one you do not rank for', () => {
  // Ranked by impressions, not by worst position: position 90 on a query
  // nobody searches is not worth anybody's morning.
  const observations = searchObservations({
    rows: [
      { keys: ['rare phrase'], clicks: 0, impressions: 6, position: 90 },
      { keys: ['common phrase'], clicks: 2, impressions: 900, position: 18 },
    ],
    windowDays: 28,
  });
  const buried = observations.find((entry) => entry.id === 'gsc_buried_query');
  assert.match(buried.statement, /common phrase/);
  assert.equal(buried.metric.value, 18);
});

check('a query you already rank for is not called buried', () => {
  const observations = searchObservations({
    rows: [{ keys: ['brand name'], clicks: 400, impressions: 900, position: 1 }],
    windowDays: 28,
  });
  assert.equal(
    observations.some((entry) => entry.id === 'gsc_buried_query'),
    false,
  );
});

check('no impressions means no observations', () => {
  assert.deepEqual(searchObservations({ rows: [], windowDays: 28 }), []);
});

console.log('\nHubSpot becomes evidence');

const deal = (stage, amount) => ({ properties: { dealstage: stage, amount: String(amount) } });

check('pipeline size and value carry the deal count as sample', () => {
  const observations = hubspotObservations({
    deals: [deal('appointmentscheduled', 1000), deal('appointmentscheduled', 2000), deal('closedwon', 500), deal('a', 1), deal('b', 1)],
  });
  const pipeline = observations.find((entry) => entry.id === 'hubspot_pipeline');
  assert.equal(pipeline.sampleSize, 5);
  assert.equal(pipeline.metric.value, 3502);
  assert.equal(pipeline.source, 'hubspot');
});

check('the fullest stage is named, using HubSpot’s own id when unmapped', () => {
  const observations = hubspotObservations({
    deals: Array.from({ length: 6 }, () => deal('appointmentscheduled', 100)),
  });
  const stage = observations.find((entry) => entry.id === 'hubspot_stage_concentration');
  // Shown as it comes rather than prettified into something official-looking
  // that might be wrong.
  assert.match(stage.statement, /appointmentscheduled/);
  assert.equal(stage.metric.value, 100);
});

check('a stage label map is used when the caller has one', () => {
  const observations = hubspotObservations({
    deals: Array.from({ length: 6 }, () => deal('s1', 100)),
    stageLabels: { s1: 'Demo booked' },
  });
  const stage = observations.find((entry) => entry.id === 'hubspot_stage_concentration');
  assert.match(stage.statement, /Demo booked/);
});

check('too few deals produce nothing', () => {
  assert.deepEqual(hubspotObservations({ deals: [deal('a', 1)] }), []);
  assert.deepEqual(hubspotObservations({ deals: [] }), []);
});

check('a deal with no amount does not become NaN', () => {
  const observations = hubspotObservations({
    deals: [
      { properties: { dealstage: 'a', amount: null } },
      ...Array.from({ length: 5 }, () => deal('a', 100)),
    ],
  });
  const pipeline = observations.find((entry) => entry.id === 'hubspot_pipeline');
  assert.equal(pipeline.metric.value, 500);
});

console.log(`\n${passed} assertions passed.`);
