#!/usr/bin/env node
import { createServer } from 'node:http';

import { WebSocketServer } from 'ws';

import { CallSession } from './session.js';
import { VaaniClient } from './vaani-client.js';
import { CARRIERS } from './protocol.js';
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

const httpServer = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({ ok: true, carriers: CARRIERS, sessions: sessions.size }),
    );
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'Not found.' }));
});

const wss = new WebSocketServer({ server: httpServer, path: undefined });
const sessions = new Set();

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
  } else if (presented !== process.env.MEDIA_GATEWAY_SECRET) {
    // Carriers cannot set arbitrary WebSocket headers, so the shared secret
    // travels as a query parameter on a wss:// URL.
    log('rejected_bad_token', { carrier });
    socket.close(1008, 'Unauthorized');
    return;
  }

  const session = new CallSession({
    carrier,
    client,
    callId: preauthorizedCallId,
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
    log('socket_close', { sessions: sessions.size });
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
