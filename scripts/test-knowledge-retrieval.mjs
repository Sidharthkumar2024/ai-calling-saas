import {
  buildKnowledgeContext,
  rankChunks,
  scoreChunk,
  tokenize,
} from '../lib/knowledge-retrieval.ts';

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else fail++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name);
};

const chunks = [
  { id: '1', content: 'Our refund policy allows a full refund within 7 days of purchase.', sourceName: 'Policies' },
  { id: '2', content: 'Delivery takes 3 to 5 working days across India.', sourceName: 'Shipping' },
  { id: '3', content: 'refund refund refund refund refund refund refund refund refund refund. ' + 'x'.repeat(3000), sourceName: 'Spam' },
  { id: '4', content: 'हमारी रिफंड नीति सात दिन की है।', sourceName: 'नीतियाँ' },
];

console.log('tokenizing:');
ok('stopwords are dropped', !tokenize('what is the refund policy').includes('the'));
ok('content words are kept', tokenize('what is the refund policy').join() === 'refund,policy');
ok(
  'DEVANAGARI SURVIVES: a Hindi question is searchable in Hindi',
  tokenize('रिफंड नीति क्या है').includes('रिफंड'),
);
ok('single characters are dropped', !tokenize('a b refund').includes('b'));
ok('an empty query yields nothing', tokenize('   ').length === 0);
ok(
  'domain words are NOT stopworded — they are what people ask about',
  tokenize('how do I add a number to my plan').join() === 'add,number,plan',
);

console.log('scoring:');
const good = scoreChunk(chunks[0], ['refund', 'policy']);
ok('a passage containing both terms scores', good.score > 0 && good.matched.length === 2);
ok('an unrelated passage scores zero', scoreChunk(chunks[1], ['refund', 'policy']).score === 0);
ok('the matched terms are reported', good.matched.join() === 'refund,policy');

console.log('ranking:');
const ranked = rankChunks(chunks, 'what is your refund policy?');
ok('the answer ranks first', ranked.chunks[0].id === '1');
ok(
  'KEYWORD STUFFING LOSES: ten repeats in a long document do not outrank the real answer',
  ranked.chunks[0].id === '1' && ranked.chunks.findIndex((c) => c.id === '3') > 0,
);
ok('irrelevant passages are excluded entirely', !ranked.chunks.some((c) => c.id === '2'));
ok(
  'HONEST LABEL: the method says keyword, not something it is not',
  ranked.method === 'keyword',
);
ok('a Hindi query finds the Hindi passage', rankChunks(chunks, 'रिफंड नीति').chunks[0].id === '4');
ok('an empty query returns nothing rather than everything', rankChunks(chunks, '').chunks.length === 0);
ok('a query matching nothing returns nothing', rankChunks(chunks, 'helicopter maintenance').chunks.length === 0);
ok('the limit is respected', rankChunks(chunks, 'refund policy days', 1).chunks.length === 1);

console.log('prompt context:');
const context = buildKnowledgeContext(rankChunks(chunks, 'refund policy'));
ok('the block contains the answer', context.text.includes('full refund within 7 days'));
ok('each passage is labelled with its source', context.text.includes('source="Policies"'));
ok(
  'THE BOUNDARY: the block says these are the only source, and what to do otherwise',
  context.text.includes('only source you may answer factual questions from') &&
    context.text.includes('never fill the gap yourself'),
);
ok('nothing matched means an empty block, not an empty promise', buildKnowledgeContext(rankChunks(chunks, 'helicopter')).text === '');
const tight = buildKnowledgeContext(rankChunks(chunks, 'refund policy'), 40);
ok('a budget too small for anything reports truncation', tight.passages.length === 0 && tight.truncated === true);
const partial = buildKnowledgeContext(rankChunks(chunks, 'refund policy days'), 120);
ok('a partial fit keeps what fits and says it was cut', partial.passages.length >= 1 && partial.truncated === true);
ok('passages are returned for citation, not just prose', context.passages[0].sourceName === 'Policies');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
