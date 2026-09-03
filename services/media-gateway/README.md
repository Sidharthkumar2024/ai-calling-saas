# Vaani media gateway

The Vaani app runs on Cloudflare Workers, which has no WebSocket, Durable
Object or queue-consumer binding — **a bidirectional media socket cannot live
there.** This service holds that socket.

It owns audio transport only:

- terminates the carrier's media WebSocket (Twilio Media Streams, Exotel
  bidirectional voicebot)
- converts G.711 mulaw/alaw ↔ PCM and resamples 8 kHz ↔ 16 kHz
- decides when the caller has stopped speaking, and detects barge-in
- streams the agent's reply back in real-time-sized 20 ms frames

Everything needing a provider key or tenant data stays in Vaani, behind one
endpoint: `POST /api/internal/voice-turn`. **The gateway holds a single shared
secret and no customer credentials.**

## Run it

```bash
cd services/media-gateway
npm install
VAANI_BASE_URL=https://your-vaani-host \
MEDIA_GATEWAY_SECRET=<same value as Vaani's> \
PORT=8787 npm start
```

`GET /health` reports liveness and the open session count.

Set the same `MEDIA_GATEWAY_SECRET` in Vaani's environment. Without it Vaani's
voice-turn endpoint returns 503 rather than accepting unauthenticated turns.

## Point a carrier at it

The carrier connects to:

```
wss://<gateway-host>/?carrier=twilio&token=<MEDIA_GATEWAY_SECRET>
```

`carrier` is `twilio` or `exotel`. The token is a query parameter because
carriers cannot set arbitrary WebSocket headers.

**The start frame must carry the Vaani call id.** Twilio sends it as a custom
parameter, Exotel as `customfield` — which is what `startOutboundCall` already
sets. A stream that arrives without one is closed rather than answered: with no
call id there is no agent, no tenant and no telemetry.

## Test it without a carrier

`test-harness/carrier.mjs` connects as Twilio would, borrows Vaani's own
text-to-speech to produce caller audio, and plays it in as if someone had
spoken — exercising the real speech-to-text, reasoning and synthesis path:

```bash
MEDIA_GATEWAY_SECRET=... VAANI_BASE_URL=http://localhost:3000 \
CALL_ID=call_xxx node test-harness/carrier.mjs
```

`npm test` runs the pure-logic suites: codec round-trips, resampling, WAV
parsing, turn detection, barge-in timing, protocol framing, and a full session
against a fake carrier and a fake Vaani.

## What it deliberately does not do

- **It does not hold credentials.** Provider keys stay in Vaani.
- **It does not decide policy.** Refunds, transfers and approvals are Vaani's
  tools, reached through the turn endpoint.
- **It does not guess at audio.** An unknown container is logged by name and
  skipped; silence is better than noise on a live call.

## Latency

A measured turn on a local run: speech-to-text 879 ms, reasoning 1418 ms,
synthesis 306 ms. The reply starts streaming as soon as synthesis returns.
