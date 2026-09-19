#!/usr/bin/env node
import { createServer } from 'node:http';

import { WebSocketServer } from 'ws';

import { CallSession } from './session.js';
import { VaaniClient } from './vaani-client.js';
import {
  CARRIERS,
  buildPong,
  isProbeFrame,
  parseInbound,
} from './protocol.js';
import { RoomRegistry } from './mixer.js';
import { verifyDialerToken } from './dialer-token.js';

/**
 * Vaani media gateway.
 *
 * The Vaani app runs on Cloudflare Workers, which has no WebSocket, Durable
 * Object or queue-consumer binding — a bidirectional media socket cannot live
 * there. This service holds the carrier socket, converts codecs, decides turn
 * boundaries and handles barge-in, and calls Vaani for each turn.
 *
 * It holds one shared secret and no customer credentials.
 */

const PORT = Number(process.env.PORT || 8787);
const client = new VaaniClient({
  baseUrl: process.env.VAANI_BASE_URL,
  secret: process.env.MEDIA_GATEWAY_SECRET,
});

function log(event, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`,
  );
}

/**
 * Commands a live session accepts (§4).
 *
 * An allow-list rather than a switch inside the session, so the set of things
 * the outside world can do to a call in progress is one short list in one
 * place. `hangup` is included because ending a call is the one control an
 * operator always needs and could not previously reach.
 */
const CONTROL_ACTIONS = [
  'mute',
  'unmute',
  'hold',
  'resume',
  'set_mode',
  'hangup',
];

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      // A control command is a few hundred bytes; anything larger is not one.
      if (size > 8192) {
        reject(new Error('Body too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

async function handleControl(request, response) {
  const send = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  const secret = process.env.MEDIA_GATEWAY_SECRET ?? '';
  // Same shared secret as the turn endpoint, in a header this time: unlike a
  // carrier, Vaani can set headers, so it does not travel in the URL.
  if (!secret || request.headers['x-vaani-gateway-secret'] !== secret) {
    log('control_unauthorized', {});
    return send(401, { error: 'Unauthorized.' });
  }
  let body;
  try {
    body = JSON.parse((await readBody(request)) || '{}');
  } catch {
    return send(400, { error: 'Body must be JSON.' });
  }
  const callId = typeof body.callId === 'string' ? body.callId.trim() : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!callId) return send(400, { error: 'callId is required.' });
  if (!CONTROL_ACTIONS.includes(action))
    return send(400, {
      error: `action must be one of ${CONTROL_ACTIONS.join(', ')}.`,
    });

  const matching = [...sessions].filter(
    (session) => session.callId === callId && !session.ended,
  );
  if (!matching.length) {
    // A distinct status, because "there is no such live call" and "the command
    // failed" need different handling by the operator and by the UI.
    log('control_no_session', { callId, action });
    return send(409, { error: 'No live leg for that call.', callId });
  }
  // A specific leg when named — muting one participant is not muting the call.
  const targets = body.legId
    ? matching.filter((session) => session.legId === body.legId)
    : matching;
  if (!targets.length)
    return send(409, { error: 'That leg is not on the call.', callId });

  const results = targets.map((session) => ({
    legId: session.legId,
    ...session.applyControl({
      action,
      mode: body.mode,
      whisperTo: body.whisperTo,
    }),
  }));
  log('control', { callId, action, legs: results.length });
  return send(results.every((result) => result.ok) ? 200 : 422, {
    callId,
    action,
    results,
  });
}

const httpServer = createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/control') {
    void handleControl(request, response).catch((error) => {
      log('control_failed', { error: String(error?.message ?? error) });
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'Control failed.' }));
      }
    });
    return;
  }
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        ok: true,
        carriers: CARRIERS,
        sessions: sessions.size,
        rooms: rooms.size,
      }),
    );
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'Not found.' }));
});

const wss = new WebSocketServer({ server: httpServer, path: undefined });
const sessions = new Set();
const rooms = new RoomRegistry();

wss.on('connection', (socket, request) => {
  // Attach the message listener before any async work. A browser sends its
  // start frame the instant the socket opens, and awaiting token verification
  // first meant those frames arrived with no listener and were dropped.
  const pending = [];
  let deliver = (frame) => pending.push(frame);
  socket.on('message', (data) => deliver(data.toString()));

  void (async () => {
  const url = new URL(request.url ?? '/', 'http://gateway.local');
  const carrier = (url.searchParams.get('carrier') ?? 'exotel').toLowerCase();
  if (!CARRIERS.includes(carrier)) {
    log('rejected_unknown_carrier', { carrier });
    socket.close(1008, 'Unsupported carrier');
    return;
  }
  const presented = url.searchParams.get('token') ?? '';
  let preauthorizedCallId = null;
  let legRole = 'agent';
  let legMode = 'duplex';
  if (carrier === 'browser') {
    // A browser tab must never hold the gateway secret. It presents a
    // short-lived token Vaani minted for exactly one call.
    const verdict = await verifyDialerToken(
      presented,
      process.env.MEDIA_GATEWAY_SECRET ?? '',
    );
    if (!verdict.ok) {
      log('rejected_dialer_token', { reason: verdict.reason });
      socket.close(1008, `Unauthorized: ${verdict.reason}`);
      return;
    }
    preauthorizedCallId = verdict.callId;
    // Role and mode come from inside the signature, never from the URL.
    legRole = verdict.role;
    legMode = verdict.mode;
  } else if (presented !== process.env.MEDIA_GATEWAY_SECRET) {
    // Carriers cannot set arbitrary WebSocket headers, so the shared secret
    // travels as a query parameter on a wss:// URL.
    log('rejected_bad_token', { carrier });
    socket.close(1008, 'Unauthorized');
    return;
  }
  if (carrier === 'vobiz') {
    // Vobiz's `start` event identifies the carrier call, not Call Vani's
    // record. The record id is placed in the signed-by-secret stream URL that
    // our answer endpoint generated after authorising the route.
    preauthorizedCallId = url.searchParams.get('callId') || null;
    if (!preauthorizedCallId) {
      log('rejected_vobiz_without_call_id', {});
      socket.close(1008, 'Missing callId');
      return;
    }
  }

  // Legs for the same call share a room, so a supervisor can join one.
  const room = preauthorizedCallId ? rooms.open(preauthorizedCallId) : null;
  const session = new CallSession({
    carrier,
    client,
    callId: preauthorizedCallId,
    role: legRole,
    mode: legMode,
    room,
    // A carrier leg has no room yet: its call id arrives in the start frame,
    // so it opens its own room at that point. Without this a real customer
    // call was never in a room, and nothing — supervisor, mute, hold — could
    // ever reach it.
    openRoom: (id) => (id ? rooms.open(id) : null),
    send: (frame) => {
      if (socket.readyState === socket.OPEN) socket.send(frame);
    },
    close: (code, reason) => socket.close(code, reason),
    log,
  });
  sessions.add(session);
  log('socket_open', { carrier, sessions: sessions.size });

  // Frames are handled one at a time so a turn cannot be started twice by
  // two frames racing through the detector.
  let queue = Promise.resolve();
  deliver = (frame) => {
    // A ping is a transport probe and needs no ordering with audio, so it is
    // answered ahead of the queue. Behind it, a ping waits for the whole turn
    // in flight — speech-to-text, reasoning and synthesis — and would report
    // the gateway's own processing as network round trip. That was measured:
    // 307 ms of "jitter" on a connection whose median round trip was 1 ms.
    if (isProbeFrame(carrier, frame)) {
      const probe = parseInbound(carrier, frame);
      if (probe.kind === 'ping') {
        const pong = buildPong(carrier, { at: probe.at });
        if (pong && socket.readyState === socket.OPEN) socket.send(pong);
        return;
      }
    }
    queue = queue.then(() =>
      session.handle(frame).catch((error) => {
        log('frame_failed', { error: String(error?.message ?? error) });
      }),
    );
  };
  // Replay whatever arrived while the token was being verified.
  for (const frame of pending.splice(0)) deliver(frame);

  socket.on('close', () => {
    session.onStop();
    sessions.delete(session);
    // `session.callId`, not `preauthorizedCallId`: a carrier leg's id is only
    // known after its start frame, and using the connect-time value leaked
    // every carrier leg's room entry.
    if (session.callId) rooms.leave(session.callId, session.legId);
    log('socket_close', { sessions: sessions.size, rooms: rooms.size });
  });
  socket.on('error', (error) => {
    log('socket_error', { error: String(error?.message ?? error) });
  });
  })().catch((error) => {
    log('connection_failed', { error: String(error?.message ?? error) });
    socket.close(1011, 'Gateway error');
  });
});

httpServer.listen(PORT, () => {
  log('listening', { port: PORT, baseUrl: process.env.VAANI_BASE_URL });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('shutting_down', { signal, sessions: sessions.size });
    for (const session of sessions) session.onStop();
    wss.close();
    httpServer.close(() => process.exit(0));
  });
}
