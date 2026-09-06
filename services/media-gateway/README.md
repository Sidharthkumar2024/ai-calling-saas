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

`carrier` is `twilio`, `exotel` or `browser`. The token is a query parameter
because carriers cannot set arbitrary WebSocket headers.

**The `browser` carrier is the dashboard dialer** and authenticates differently:
it presents a short-lived token Vaani minted for one call id, not the gateway
secret, because a browser tab must never hold that secret. The call id comes
from the verified token rather than from a frame the tab controls, so a tab
cannot claim someone else's call.

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

## Rooms, transfer and supervision

Every leg of a call joins a room keyed by the call id, so several legs can be
bridged. Each leg carries a role (`agent`, `ai`, `customer`, `supervisor`) and a
mode, and the mode decides who hears whom:

| mode | hears | is heard by |
|---|---|---|
| `duplex` | everyone else | everyone |
| `listen` | everyone | **nobody** |
| `whisper` | everyone | only its `whisperTo` target |

**Role and mode are signed into the token**, never read from the URL, so a
supervisor cannot promote a listening session into a speaking one by editing a
query parameter.

A whisper is routed to one leg, so a leg that *joins* whispering has no target
and reaches nobody. The gateway resolves that target at join time — the human
`agent` leg, never the AI and never the customer — and where there is no human
agent to coach it joins as `listen` instead. Either way it sends the browser a
`{"event":"mode"}` frame with the mode it actually got and, when that is not
what was asked for, the reason (`no_agent_to_whisper_to`,
`whisper_target_left`). The supervisor's panel shows that frame, not the
request: believing you are whispering while you are silent is the failure this
prevents. The same frame follows a mid-call demotion, which happens when the
agent being coached hangs up.

Transfer falls out of this: once a human agent is in the room as a `duplex`
leg, `Room.aiShouldRespond()` returns false and the AI stops answering rather
than talking over them.

`src/mixer.js` holds the routing and mixing as pure functions, because the rule
that a whisper must never reach the customer is not a nice-to-have — it is
tested directly, and mixing accumulates in 32-bit before clamping so two loud
speakers produce a clamped peak rather than a wrapped click.

## What it deliberately does not do

- **It does not hold credentials.** Provider keys stay in Vaani.
- **It does not decide policy.** Refunds, transfers and approvals are Vaani's
  tools, reached through the turn endpoint.
- **It does not guess at audio.** An unknown container is logged by name and
  skipped; silence is better than noise on a live call.

## Latency

A measured turn on a local run: speech-to-text 879 ms, reasoning 1418 ms,
synthesis 306 ms. The reply starts streaming as soon as synthesis returns.
