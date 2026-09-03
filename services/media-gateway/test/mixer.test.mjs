import {
  Room,
  RoomRegistry,
  audibleTo,
  mixFrames,
} from '../src/mixer.js';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

const leg = (id, role, mode = 'duplex', whisperTo = null) => ({
  id,
  role,
  mode,
  whisperTo,
});

console.log('mixing:');
ok(
  'two frames sum',
  (() => {
    const out = mixFrames(
      [new Int16Array([100, 200]), new Int16Array([50, -100])],
      2,
    );
    return out[0] === 150 && out[1] === 100;
  })(),
);
ok(
  'a loud sum clamps instead of wrapping',
  (() => {
    const out = mixFrames(
      [new Int16Array([30000]), new Int16Array([30000])],
      1,
    );
    return out[0] === 32767;
  })(),
);
ok(
  'a loud negative sum clamps too',
  mixFrames([new Int16Array([-30000]), new Int16Array([-30000])], 1)[0] ===
    -32768,
);
ok(
  'no frames yields silence, not undefined',
  (() => {
    const out = mixFrames([], 4);
    return out.length === 4 && out.every((value) => value === 0);
  })(),
);
ok(
  'one speaker is passed through unchanged',
  mixFrames([new Int16Array([1234])], 1)[0] === 1234,
);
ok(
  'a short frame does not read past its end',
  (() => {
    const out = mixFrames([new Int16Array([5]), new Int16Array([1, 2, 3])], 3);
    return out[0] === 6 && out[1] === 2 && out[2] === 3;
  })(),
);

console.log('who hears whom:');
const agent = leg('L1', 'agent');
const ai = leg('L2', 'ai');
const customer = leg('L3', 'customer');
ok(
  'a leg never hears itself',
  !audibleTo(agent, [agent, ai]).some((l) => l.id === 'L1'),
);
ok(
  'duplex legs hear each other',
  audibleTo(agent, [agent, ai]).map((l) => l.id).join() === 'L2',
);
ok(
  'a silent monitor is heard by nobody',
  (() => {
    const supervisor = leg('S1', 'supervisor', 'listen');
    return audibleTo(agent, [agent, ai, supervisor]).every(
      (l) => l.id !== 'S1',
    );
  })(),
);
ok(
  'a monitor still hears everyone',
  (() => {
    const supervisor = leg('S1', 'supervisor', 'listen');
    const heard = audibleTo(supervisor, [agent, ai, supervisor]).map((l) => l.id);
    return heard.includes('L1') && heard.includes('L2');
  })(),
);
ok(
  'a whisper reaches only its target',
  (() => {
    const supervisor = leg('S1', 'supervisor', 'whisper', 'L1');
    const toAgent = audibleTo(agent, [agent, ai, supervisor]).map((l) => l.id);
    const toAi = audibleTo(ai, [agent, ai, supervisor]).map((l) => l.id);
    return toAgent.includes('S1') && !toAi.includes('S1');
  })(),
);
ok(
  'THE IMPORTANT ONE: a whisper never reaches the customer',
  (() => {
    const supervisor = leg('S1', 'supervisor', 'whisper', 'L1');
    return !audibleTo(customer, [agent, customer, supervisor])
      .map((l) => l.id)
      .includes('S1');
  })(),
);
ok(
  'a joined supervisor is heard by everyone',
  (() => {
    const supervisor = leg('S1', 'supervisor', 'duplex');
    return audibleTo(customer, [customer, supervisor])
      .map((l) => l.id)
      .includes('S1');
  })(),
);

console.log('room membership:');
ok(
  'legs are added and counted',
  (() => {
    const room = new Room('call_1');
    room.add(leg('L1', 'agent'));
    room.add(leg('L2', 'ai'));
    return room.size === 2 && room.byRole('ai').length === 1;
  })(),
);
ok(
  'an unknown role is refused',
  (() => {
    const room = new Room('call_1');
    try {
      room.add(leg('L1', 'intruder'));
      return false;
    } catch {
      return true;
    }
  })(),
);
ok(
  'an unknown mode is refused',
  (() => {
    const room = new Room('call_1');
    try {
      room.add(leg('L1', 'agent', 'shout'));
      return false;
    } catch {
      return true;
    }
  })(),
);

console.log('mode changes:');
ok(
  'whisper needs a target',
  (() => {
    const room = new Room('c');
    room.add(leg('S1', 'supervisor', 'listen'));
    return room.setMode('S1', 'whisper').reason === 'whisper_needs_target';
  })(),
);
ok(
  'whisper cannot target a leg that is not in the room',
  (() => {
    const room = new Room('c');
    room.add(leg('S1', 'supervisor', 'listen'));
    return (
      room.setMode('S1', 'whisper', 'ghost').reason ===
      'whisper_target_not_in_room'
    );
  })(),
);
ok(
  'whisper cannot target itself',
  (() => {
    const room = new Room('c');
    room.add(leg('S1', 'supervisor', 'listen'));
    return room.setMode('S1', 'whisper', 'S1').reason === 'cannot_whisper_to_self';
  })(),
);
ok(
  'a valid whisper is accepted',
  (() => {
    const room = new Room('c');
    room.add(leg('L1', 'agent'));
    room.add(leg('S1', 'supervisor', 'listen'));
    const r = room.setMode('S1', 'whisper', 'L1');
    return r.ok && room.find('S1').whisperTo === 'L1';
  })(),
);
ok(
  'switching away from whisper clears the target',
  (() => {
    const room = new Room('c');
    room.add(leg('L1', 'agent'));
    room.add(leg('S1', 'supervisor', 'whisper', 'L1'));
    room.setMode('S1', 'listen');
    return room.find('S1').whisperTo === null;
  })(),
);
ok(
  'when a whisper target leaves, the whisperer falls back to listening',
  (() => {
    const room = new Room('c');
    room.add(leg('L1', 'agent'));
    room.add(leg('S1', 'supervisor', 'whisper', 'L1'));
    room.remove('L1');
    const supervisor = room.find('S1');
    return supervisor.mode === 'listen' && supervisor.whisperTo === null;
  })(),
);

console.log('AI hand-off:');
ok(
  'the AI answers while no human is a participant',
  (() => {
    const room = new Room('c');
    room.add(leg('C1', 'customer'));
    room.add(leg('AI', 'ai'));
    return room.aiShouldRespond() === true;
  })(),
);
ok(
  'the AI stops once a human joins as a participant',
  (() => {
    const room = new Room('c');
    room.add(leg('C1', 'customer'));
    room.add(leg('AI', 'ai'));
    room.add(leg('L1', 'agent', 'duplex'));
    return room.aiShouldRespond() === false;
  })(),
);
ok(
  'a silent supervisor does not stop the AI',
  (() => {
    const room = new Room('c');
    room.add(leg('C1', 'customer'));
    room.add(leg('AI', 'ai'));
    room.add(leg('S1', 'supervisor', 'listen'));
    return room.aiShouldRespond() === true;
  })(),
);

console.log('registry:');
ok(
  'a room is reused for the same call',
  (() => {
    const registry = new RoomRegistry();
    return registry.open('c1') === registry.open('c1') && registry.size === 1;
  })(),
);
ok(
  'separate calls get separate rooms',
  (() => {
    const registry = new RoomRegistry();
    registry.open('c1');
    registry.open('c2');
    return registry.size === 2;
  })(),
);
ok(
  'the room closes when the last leg leaves',
  (() => {
    const registry = new RoomRegistry();
    const room = registry.open('c1');
    room.add(leg('L1', 'agent'));
    room.add(leg('L2', 'ai'));
    registry.leave('c1', 'L1');
    const stillOpen = registry.size === 1;
    registry.leave('c1', 'L2');
    return stillOpen && registry.size === 0;
  })(),
);
ok(
  'leaving an unknown call is a no-op, not a throw',
  (() => {
    const registry = new RoomRegistry();
    return registry.leave('nope', 'L1') === null;
  })(),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
