import assert from 'node:assert/strict';

import {
  CALL_CONTROL_ACTIONS,
  controlEndpoint,
  isCallControlAction,
} from '../lib/call-control.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log('controlEndpoint');

check('the carrier stream URL becomes the gateway control URL', () => {
  // Derived from VOICE_STREAM_URL rather than configured separately, so there
  // is no second URL to set and get wrong.
  assert.equal(
    controlEndpoint('wss://gateway.example.com/stream?carrier=exotel'),
    'https://gateway.example.com/control',
  );
  assert.equal(
    controlEndpoint('ws://localhost:8787/'),
    'http://localhost:8787/control',
  );
});

check('a non-default port is kept', () => {
  assert.equal(
    controlEndpoint('wss://gateway.example.com:9443/stream'),
    'https://gateway.example.com:9443/control',
  );
});

check('an http base is accepted as it is', () => {
  assert.equal(
    controlEndpoint('https://gateway.example.com'),
    'https://gateway.example.com/control',
  );
});

check('nothing configured returns null rather than a guess', () => {
  // A command sent to a wrong host is worse than one never sent, because the
  // operator is told it worked.
  assert.equal(controlEndpoint(undefined), null);
  assert.equal(controlEndpoint(''), null);
  assert.equal(controlEndpoint('   '), null);
});

check('an unusable value returns null', () => {
  assert.equal(controlEndpoint('not a url'), null);
  assert.equal(controlEndpoint('gateway.example.com/stream'), null);
  // A scheme that is not a transport we speak must not be coerced into one.
  assert.equal(controlEndpoint('ftp://gateway.example.com'), null);
  assert.equal(controlEndpoint('javascript:alert(1)'), null);
});

check('the path on the stream URL never leaks into the control URL', () => {
  // The carrier URL carries a stream path and query; the control endpoint is
  // a fixed path on the same origin.
  assert.equal(
    controlEndpoint('wss://gw.example.com/a/b/c?token=secret&carrier=twilio'),
    'https://gw.example.com/control',
  );
});

console.log('isCallControlAction');

check('the allow-list is exactly what the gateway accepts', () => {
  assert.deepEqual(
    [...CALL_CONTROL_ACTIONS],
    ['mute', 'unmute', 'hold', 'resume', 'set_mode', 'hangup'],
  );
});

check('anything else is refused before a request is made', () => {
  for (const action of CALL_CONTROL_ACTIONS)
    assert.equal(isCallControlAction(action), true, action);
  assert.equal(isCallControlAction('shutdown'), false);
  assert.equal(isCallControlAction('MUTE'), false);
  assert.equal(isCallControlAction(''), false);
  assert.equal(isCallControlAction(null), false);
  assert.equal(isCallControlAction({ action: 'mute' }), false);
});

console.log(`\n${passed} assertions passed.`);
