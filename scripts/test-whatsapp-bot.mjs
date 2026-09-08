import assert from 'node:assert/strict';

import {
  botSkipReason,
  normalisePhone,
} from '../lib/whatsapp-bot-rules.ts';
import {
  CHAT_TRIGGERS,
  SILENT_TRIGGERS,
  TRIGGER_EVENTS,
  NODE_SPECS,
  validateWorkflow,
} from '../lib/workflow-nodes.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

const inbound = (over = {}) => ({
  messageType: 'text',
  body: 'Is the 2BHK still free?',
  isNew: true,
  assignedAgentId: null,
  ...over,
});

// --- when a bot must keep quiet -----------------------------------------------

check(() => assert.equal(botSkipReason(inbound()), null));
// Meta retries any webhook it did not get a 200 from. Answering twice is the
// mistake that shows.
check(() => assert.equal(botSkipReason(inbound({ isNew: false })), 'duplicate'));
// A colleague has the conversation. The bot does not talk over them.
check(() =>
  assert.equal(
    botSkipReason(inbound({ assignedAgentId: 'sa_sup' })),
    'human_assigned',
  ),
);
// A photo is not a sentence for a graph to branch on.
check(() =>
  assert.equal(botSkipReason(inbound({ messageType: 'image' })), 'not_text'),
);
check(() =>
  assert.equal(botSkipReason(inbound({ messageType: 'audio' })), 'not_text'),
);
check(() => assert.equal(botSkipReason(inbound({ body: '   ' })), 'empty'));
check(() => assert.equal(botSkipReason(inbound({ body: null })), 'empty'));
// A claimed conversation stays claimed whatever kind of message arrives, and
// the duplicate check comes first so a retry never even looks assigned.
check(() =>
  assert.equal(
    botSkipReason(inbound({ isNew: false, assignedAgentId: 'sa_sup' })),
    'duplicate',
  ),
);

// --- the trigger ---------------------------------------------------------------

check(() => assert.ok(TRIGGER_EVENTS.includes('whatsapp_message')));
check(() => assert.deepEqual(CHAT_TRIGGERS, ['whatsapp_message']));
// It has no audio, but it does have somebody at the other end — which is the
// difference between "cannot speak" and "answers slowly".
check(() => assert.ok(!SILENT_TRIGGERS.includes('whatsapp_message')));
check(() =>
  assert.ok(
    NODE_SPECS.trigger.fields[0].options.includes('whatsapp_message'),
  ),
);
// An Ask over WhatsApp parks the run rather than holding it open.
check(() => assert.equal(NODE_SPECS.ask.canSuspend, true));

// --- what the validator allows -------------------------------------------------

const graph = (event, extra = []) => ({
  nodes: [
    {
      id: 't',
      kind: 'trigger',
      config: { event },
      next: { next: 'a' },
    },
    {
      id: 'a',
      kind: 'ask',
      config: { question: 'Which area?', variable: 'area' },
      next: { next: 's' },
    },
    {
      id: 's',
      kind: 'say',
      config: { text: 'Thanks, checking {{area}} now.' },
      next: { next: 'e' },
    },
    { id: 'e', kind: 'end', config: { disposition: 'answered' }, next: {} },
    ...extra,
  ],
});

const errorsOf = (event) => validateWorkflow(graph(event)).errors;

// Ask and Say are exactly what a chatbot is made of, so this must pass.
check(() => assert.deepEqual(errorsOf('whatsapp_message'), []));
check(() => assert.deepEqual(errorsOf('inbound_call'), []));
// Nobody to write to or speak to.
check(() =>
  assert.ok(errorsOf('webhook').some((issue) => /somebody on the line/.test(issue.message))),
);
check(() =>
  assert.ok(errorsOf('scheduled').some((issue) => /somebody on the line/.test(issue.message))),
);

// --- the number a run is parked against ----------------------------------------

// The parked run is found by number, so every spelling of one number has to
// reduce to the same key or a reply wakes nothing.
check(() => assert.equal(normalisePhone('+91 98123 45678'), '+919812345678'));
check(() => assert.equal(normalisePhone('919812345678'), '+919812345678'));
check(() => assert.equal(normalisePhone('+91-98123-45678'), '+919812345678'));
check(() => assert.equal(normalisePhone('(91) 9812345678'), '+919812345678'));
check(() => assert.equal(normalisePhone(''), ''));
check(() => assert.equal(normalisePhone('   '), ''));

console.log(`whatsapp bot: ${checks} assertions passed`);
