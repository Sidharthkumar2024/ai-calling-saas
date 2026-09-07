import assert from 'node:assert/strict';

import {
  previewOf,
  replyWindow,
  REPLY_WINDOW_MS,
  toConversations,
} from '../lib/whatsapp-inbox.ts';

let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

const msg = (over = {}) => ({
  id: over.id ?? `m${checks}`,
  sender_phone: '+919876543210',
  direction: 'inbound',
  message_type: 'text',
  body: 'hello',
  media_id: null,
  created_at: '2026-09-07 10:00:00',
  ...over,
});

// --- grouping -----------------------------------------------------------------

check(() => assert.deepEqual(toConversations([]), []));

check(() => {
  const list = toConversations([
    msg({ id: 'a', sender_phone: '+91111', created_at: '2026-09-07 10:00:00' }),
    msg({ id: 'b', sender_phone: '+91222', created_at: '2026-09-07 11:00:00' }),
  ]);
  assert.equal(list.length, 2);
  // Newest conversation first.
  assert.equal(list[0].phone, '+91222');
});

// A thread read backwards is not a thread: rows arrive newest-first and are put
// back into the order they were said.
check(() => {
  const [conversation] = toConversations([
    msg({ id: 'later', body: 'second', created_at: '2026-09-07 11:00:00' }),
    msg({ id: 'earlier', body: 'first', created_at: '2026-09-07 10:00:00' }),
  ]);
  assert.deepEqual(
    conversation.messages.map((m) => m.body),
    ['first', 'second'],
  );
});

check(() => {
  const [conversation] = toConversations([
    msg({ direction: 'inbound', created_at: '2026-09-07 10:00:00' }),
    msg({ direction: 'outbound', body: 'ours', created_at: '2026-09-07 12:00:00' }),
  ]);
  assert.equal(conversation.inboundCount, 1);
  // The window starts at their last message, not at ours.
  assert.equal(conversation.lastInboundAt, '2026-09-07 10:00:00');
  assert.equal(conversation.lastAt, '2026-09-07 12:00:00');
  assert.equal(conversation.preview, 'ours');
});

check(() => {
  const [conversation] = toConversations([msg({ sender_phone: '  ' })]);
  assert.equal(conversation.phone, 'unknown');
});

// --- previews -----------------------------------------------------------------

check(() => assert.equal(previewOf(msg({ body: 'short' })), 'short'));
check(() =>
  assert.equal(
    previewOf(msg({ body: null, media_id: 'x', message_type: 'image' })),
    '[image]',
  ),
);
check(() =>
  assert.equal(previewOf(msg({ body: null, media_id: null, message_type: '' })), '[message]'),
);
check(() => {
  const long = previewOf(msg({ body: 'x'.repeat(200) }));
  assert.equal(long.length, 90);
  assert.match(long, /…$/);
});

// --- the 24-hour window --------------------------------------------------------

const at = (iso) => Date.parse(iso);

check(() => {
  const window = replyWindow({ lastInboundAt: null });
  assert.equal(window.open, false);
  assert.match(window.reason, /approved template/);
});

check(() => {
  const window = replyWindow(
    { lastInboundAt: '2026-09-07 10:00:00' },
    at('2026-09-07T12:00:00Z'),
  );
  assert.equal(window.open, true);
  assert.equal(window.hoursLeft, 22);
});

// THE BOUNDARY: at exactly 24 hours the window is shut, not "0 hours left".
check(() => {
  const window = replyWindow(
    { lastInboundAt: '2026-09-07 10:00:00' },
    at('2026-09-07T10:00:00Z') + REPLY_WINDOW_MS,
  );
  assert.equal(window.open, false);
  assert.match(window.reason, /More than 24 hours/);
});

check(() => {
  const window = replyWindow(
    { lastInboundAt: '2026-09-07 10:00:00' },
    at('2026-09-07T10:00:00Z') + REPLY_WINDOW_MS - 1000,
  );
  assert.equal(window.open, true);
  // Never rounds down to "0 hours left" while the window is still open.
  assert.equal(window.hoursLeft, 1);
});

// THE ONE THAT WOULD HAVE BEEN HOURS OUT: SQLite writes UTC with no zone
// marker. Parsed as local time, the window opens or closes wrongly depending on
// where the reader is sitting.
check(() => {
  const window = replyWindow(
    { lastInboundAt: '2026-09-07 10:00:00' },
    at('2026-09-07T10:30:00Z'),
  );
  assert.equal(window.hoursLeft, 23);
});

// An ISO timestamp with its own zone is respected rather than mangled.
check(() => {
  const window = replyWindow(
    { lastInboundAt: '2026-09-07T10:00:00.000Z' },
    at('2026-09-07T11:00:00Z'),
  );
  assert.equal(window.hoursLeft, 23);
});

// An unreadable timestamp closes the window rather than opening it by accident.
check(() => {
  const window = replyWindow({ lastInboundAt: 'not a date' }, at('2026-09-07T10:00:00Z'));
  assert.equal(window.open, false);
});

console.log(`whatsapp-inbox: ${checks} assertions passed`);
