import assert from 'node:assert/strict';

import { parseBlocks, parseInline } from '../lib/chat-markdown.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

// --- inline ------------------------------------------------------------------

check(() =>
  assert.deepEqual(parseInline('plain'), [{ kind: 'text', text: 'plain' }]),
);
check(() =>
  assert.deepEqual(parseInline('a **b** c'), [
    { kind: 'text', text: 'a ' },
    { kind: 'bold', text: 'b' },
    { kind: 'text', text: ' c' },
  ]),
);
check(() =>
  assert.deepEqual(parseInline('run `npm test` now'), [
    { kind: 'text', text: 'run ' },
    { kind: 'code', text: 'npm test' },
    { kind: 'text', text: ' now' },
  ]),
);
// A stray asterisk is a character, not an unterminated bold that swallows the
// rest of the answer.
check(() =>
  assert.deepEqual(parseInline('2 ** 3 is eight'), [
    { kind: 'text', text: '2 ** 3 is eight' },
  ]),
);
// Asterisks inside code stay inside code.
check(() => {
  const spans = parseInline('use `a ** b` here');
  assert.equal(spans[1].kind, 'code');
  assert.equal(spans[1].text, 'a ** b');
});

// --- blocks ------------------------------------------------------------------

check(() => {
  const blocks = parseBlocks('Hello there');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'paragraph');
});

// Wrapped lines are one paragraph, not three.
check(() => {
  const blocks = parseBlocks('one\ntwo\nthree');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].spans[0].text, 'one two three');
});

check(() => {
  const blocks = parseBlocks('## Plan\n\nDo it');
  assert.equal(blocks[0].kind, 'heading');
  assert.equal(blocks[0].level, 2);
  assert.equal(blocks[1].kind, 'paragraph');
});
check(() => assert.equal(parseBlocks('#### deep')[0].level, 3));

check(() => {
  const blocks = parseBlocks('- one\n- two\n- three');
  assert.equal(blocks[0].kind, 'list');
  assert.equal(blocks[0].ordered, false);
  assert.equal(blocks[0].items.length, 3);
});
check(() => {
  const blocks = parseBlocks('1. first\n2. second');
  assert.equal(blocks[0].ordered, true);
  assert.equal(blocks[0].items[1][0].text, 'second');
});
// A list ends where the prose starts again.
check(() => {
  const blocks = parseBlocks('- one\n- two\n\nAfter the list');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].kind, 'paragraph');
  assert.equal(blocks[1].spans[0].text, 'After the list');
});
// THE ONE THAT ATE TEXT: a line right after a list must not be dropped.
check(() => {
  const blocks = parseBlocks('- one\nplain line');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].spans[0].text, 'plain line');
});

check(() => {
  const blocks = parseBlocks('```sql\nSELECT 1;\n```');
  assert.equal(blocks[0].kind, 'code');
  assert.equal(blocks[0].language, 'sql');
  assert.equal(blocks[0].text, 'SELECT 1;');
});
// A fence still arriving mid-stream renders what has come so far.
check(() => {
  const blocks = parseBlocks('```\nhalf a query');
  assert.equal(blocks[0].kind, 'code');
  assert.equal(blocks[0].text, 'half a query');
});

// Markup a model might emit is text, never elements: this parser has no HTML
// path at all, which is what makes the renderer safe.
check(() => {
  const blocks = parseBlocks('<img src=x onerror=alert(1)>');
  assert.equal(blocks[0].kind, 'paragraph');
  assert.equal(blocks[0].spans[0].text, '<img src=x onerror=alert(1)>');
});

check(() => assert.deepEqual(parseBlocks(''), []));
check(() => assert.deepEqual(parseBlocks('   \n  \n'), []));

console.log(`chat-markdown: ${checks} assertions passed`);
