/**
 * Reading a server-sent event stream, and pulling the text out of one.
 *
 * Both reasoning providers stream the same way — `text/event-stream`, one JSON
 * object per `data:` line — and both split those lines across network chunks
 * wherever they please. A parser that assumes a chunk is a whole event drops
 * the tail of one message and the head of the next, which shows up as words
 * missing from the middle of an answer rather than as an error.
 *
 * So this holds a buffer, hands back only complete events, and knows the two
 * shapes the deltas arrive in. Pure: no fetch, no sockets, so the buffering
 * rules are tested directly.
 */

export type SseEvent = { event: string | null; data: string };

export function createSseParser() {
  let buffer = '';
  return {
    /** Complete events in this chunk. Anything partial stays in the buffer. */
    push(chunk: string): SseEvent[] {
      buffer += chunk;
      const events: SseEvent[] = [];
      // Events end with a blank line. Servers use \n\n; some proxies rewrite
      // to \r\n\r\n, and a stream that mixes them is still one stream.
      let boundary = findBoundary(buffer);
      while (boundary) {
        const raw = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const parsed = parseBlock(raw);
        if (parsed) events.push(parsed);
        boundary = findBoundary(buffer);
      }
      return events;
    },
    /** Whatever never got its blank line — a truncated stream, not an event. */
    rest(): string {
      return buffer;
    },
  };
}

function findBoundary(value: string) {
  const lf = value.indexOf('\n\n');
  const crlf = value.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf))
    return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

function parseBlock(block: string): SseEvent | null {
  let event: string | null = null;
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue; // comment / keep-alive
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    // "data: x" and "data:x" are the same field; only one leading space goes.
    const raw = separator === -1 ? '' : line.slice(separator + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}

export type ProviderShape = 'openai' | 'anthropic';

/**
 * The text this event adds to the answer, or null if it adds none.
 *
 * Only the delta events carry text. The completed events repeat the whole
 * answer, and counting those as well would print everything twice.
 */
export function textDelta(
  shape: ProviderShape,
  event: SseEvent,
): string | null {
  if (event.data === '[DONE]') return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(event.data) as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = eventType(payload, event);
  if (shape === 'openai') {
    if (type !== 'response.output_text.delta') return null;
    return typeof payload.delta === 'string' ? payload.delta : null;
  }
  if (type !== 'content_block_delta') return null;
  const delta = payload.delta as { type?: string; text?: string } | undefined;
  return delta?.type === 'text_delta' && typeof delta.text === 'string'
    ? delta.text
    : null;
}

/** The model name a stream reports, so a turn can be recorded against it. */
export function modelName(
  shape: ProviderShape,
  event: SseEvent,
): string | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(event.data) as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = eventType(payload, event);
  if (shape === 'openai') {
    if (type !== 'response.created') return null;
    const response = payload.response as { model?: unknown } | undefined;
    return typeof response?.model === 'string' ? response.model : null;
  }
  if (type !== 'message_start') return null;
  const message = payload.message as { model?: unknown } | undefined;
  return typeof message?.model === 'string' ? message.model : null;
}

/** An error the provider reported mid-stream, which is not a text delta. */
export function streamError(event: SseEvent): string | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(event.data) as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = eventType(payload, event);
  if (type !== 'error' && type !== 'response.failed') return null;
  const error = payload.error as { message?: unknown } | undefined;
  return typeof error?.message === 'string'
    ? error.message
    : 'The reasoning provider ended the stream early.';
}

/** The event's own name, from the payload if it has one, else the SSE field. */
function eventType(payload: Record<string, unknown>, event: SseEvent): string {
  if (typeof payload.type === 'string') return payload.type;
  return event.event ?? '';
}
