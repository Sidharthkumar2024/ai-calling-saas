import assert from 'node:assert/strict';

import {
  createSseParser,
  modelName,
  streamError,
  textDelta,
} from '../lib/sse.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

// --- buffering ---------------------------------------------------------------

check(() => {
  const parser = createSseParser();
  const events = parser.push('data: {"a":1}\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].data, '{"a":1}');
});

// THE ONE THAT MATTERS: an event split across two chunks is one event, not two
// broken ones. Providers split wherever the network does.
check(() => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('data: {"he'), []);
  const events = parser.push('llo":true}\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].data, '{"hello":true}');
});

check(() => {
  const parser = createSseParser();
  const events = parser.push('data: one\n\ndata: two\n\ndata: thr');
  assert.deepEqual(events.map((e) => e.data), ['one', 'two']);
  assert.equal(parser.rest(), 'data: thr');
});

// \r\n is the same stream.
check(() => {
  const parser = createSseParser();
  const events = parser.push('event: ping\r\ndata: {"x":1}\r\n\r\n');
  assert.equal(events[0].event, 'ping');
  assert.equal(events[0].data, '{"x":1}');
});

// Keep-alive comments carry no data and are not events.
check(() => {
  const parser = createSseParser();
  assert.deepEqual(parser.push(': keep-alive\n\n'), []);
});

// One leading space after the colon belongs to the protocol, not the payload.
check(() => {
  const parser = createSseParser();
  assert.equal(parser.push('data:{"tight":1}\n\n')[0].data, '{"tight":1}');
});
check(() => {
  const parser = createSseParser();
  assert.equal(parser.push('data:  padded\n\n')[0].data, ' padded');
});

// Multi-line data joins with newlines, which is how a code block survives.
check(() => {
  const parser = createSseParser();
  assert.equal(parser.push('data: a\ndata: b\n\n')[0].data, 'a\nb');
});

// --- text deltas -------------------------------------------------------------

const openaiDelta = {
  event: null,
  data: JSON.stringify({ type: 'response.output_text.delta', delta: 'Hel' }),
};
check(() => assert.equal(textDelta('openai', openaiDelta), 'Hel'));

// The completed event repeats the whole answer. Counting it would print the
// reply twice.
check(() =>
  assert.equal(
    textDelta('openai', {
      event: null,
      data: JSON.stringify({
        type: 'response.output_text.done',
        text: 'Hello there',
      }),
    }),
    null,
  ),
);

const anthropicDelta = {
  event: null,
  data: JSON.stringify({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: 'lo' },
  }),
};
check(() => assert.equal(textDelta('anthropic', anthropicDelta), 'lo'));

// A thinking delta is not answer text.
check(() =>
  assert.equal(
    textDelta('anthropic', {
      event: null,
      data: JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'hmm' },
      }),
    }),
    null,
  ),
);

check(() => assert.equal(textDelta('openai', { event: null, data: '[DONE]' }), null));
check(() => assert.equal(textDelta('openai', { event: null, data: 'not json' }), null));
// A provider's event never crosses shapes.
check(() => assert.equal(textDelta('anthropic', openaiDelta), null));
check(() => assert.equal(textDelta('openai', anthropicDelta), null));

// --- model and errors --------------------------------------------------------

check(() =>
  assert.equal(
    modelName('openai', {
      event: null,
      data: JSON.stringify({
        type: 'response.created',
        response: { model: 'gpt-5.4-mini' },
      }),
    }),
    'gpt-5.4-mini',
  ),
);
check(() =>
  assert.equal(
    modelName('anthropic', {
      event: null,
      data: JSON.stringify({
        type: 'message_start',
        message: { model: 'claude-sonnet-5' },
      }),
    }),
    'claude-sonnet-5',
  ),
);
check(() => assert.equal(modelName('openai', openaiDelta), null));

check(() =>
  assert.equal(
    streamError({
      event: null,
      data: JSON.stringify({ type: 'error', error: { message: 'overloaded' } }),
    }),
    'overloaded',
  ),
);
// An error with no message still reads as an error rather than as silence.
check(() =>
  assert.match(
    streamError({ event: null, data: JSON.stringify({ type: 'error' }) }) ?? '',
    /ended the stream early/,
  ),
);
check(() => assert.equal(streamError(openaiDelta), null));

console.log(`sse: ${checks} assertions passed`);
