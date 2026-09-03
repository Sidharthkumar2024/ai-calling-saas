#!/usr/bin/env node
import { createServer } from 'node:http';

import { WebSocketServer } from 'ws';

import { CallSession } from './session.js';
import { VaaniClient } from './vaani-client.js';
import { CARRIERS } from './protocol.js';

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
  const url = new URL(request.url ?? '/', 'http://gateway.local');
  const carrier = (url.searchParams.get('carrier') ?? 'exotel').toLowerCase();
  if (!CARRIERS.includes(carrier)) {
    log('rejected_unknown_carrier', { carrier });
    socket.close(1008, 'Unsupported carrier');
    return;
  }
  // The carrier proves itself with the same shared secret, passed as a query
  // parameter because carriers cannot set arbitrary WebSocket headers.
  if (url.searchParams.get('token') !== process.env.MEDIA_GATEWAY_SECRET) {
    log('rejected_bad_token', { carrier });
    socket.close(1008, 'Unauthorized');
    return;
  }

  const session = new CallSession({
    carrier,
    client,
    send: (frame) => {
      if (socket.readyState === socket.OPEN) socket.send(frame);
    },
    close: (code, reason) => socket.close(code, reason),
    log,
  });
  sessions.add(session);
  log('socket_open', { carrier, sessions: sessions.size });

  socket.on('message', (data) => {
    void session.handle(data.toString()).catch((error) => {
      log('frame_failed', { error: String(error?.message ?? error) });
    });
  });
  socket.on('close', () => {
    session.onStop();
    sessions.delete(session);
    log('socket_close', { sessions: sessions.size });
  });
  socket.on('error', (error) => {
    log('socket_error', { error: String(error?.message ?? error) });
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
