import assert from 'node:assert/strict';

import {
  botSkipReason,
  destinationFor,
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

// --- who a step reaches when the run is a conversation --------------------------

// An author who does not think to write {{phone}} into every node should not
// get steps that silently skip in a conversation with the very person they
// were about to reach.
check(() =>
  assert.deepEqual(destinationFor('', '919812345678'), {
    to: '+919812345678',
    unresolved: false,
    fromConversation: true,
  }),
);
check(() =>
  assert.deepEqual(destinationFor('   ', '+91 98123 45678'), {
    to: '+919812345678',
    unresolved: false,
    fromConversation: true,
  }),
);
// An explicit destination is never overridden: an author may mean somebody
// else, and a payment link is not a thing to redirect on a guess.
check(() =>
  assert.deepEqual(destinationFor('+919000000000', '919812345678'), {
    to: '+919000000000',
    unresolved: false,
    fromConversation: false,
  }),
);
// An unresolved placeholder is the author's mistake to see. Sending it to the
// customer instead could put somebody else's payment link in front of them.
check(() =>
  assert.deepEqual(destinationFor('{{accountant_phone}}', '919812345678'), {
    to: '',
    unresolved: true,
    fromConversation: false,
  }),
);
check(() =>
  assert.deepEqual(destinationFor('', ''), {
    to: '',
    unresolved: false,
    fromConversation: false,
  }),
);
check(() =>
  assert.deepEqual(destinationFor('', null), {
    to: '',
    unresolved: false,
    fromConversation: false,
  }),
);
// A voice run has no conversation to fall back to, so nothing changes there.
check(() => assert.equal(destinationFor('', undefined).to, ''));

console.log(`whatsapp bot: ${checks} assertions passed`);
