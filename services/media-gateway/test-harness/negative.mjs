import WebSocket from 'ws';
import { mintDialerToken } from '../src/dialer-token.js';

const SECRET = process.env.MEDIA_GATEWAY_SECRET ?? '';
function attempt(label, token) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:8787/?carrier=browser&token=${encodeURIComponent(token)}`);
    let settled = false;
    ws.on('close', (code, reason) => {
      if (!settled) { settled = true; resolve({ label, code, reason: reason.toString() }); }
    });
    ws.on('open', () => ws.send(JSON.stringify({ event: 'start' })));
    setTimeout(() => { if (!settled) { settled = true; ws.close(); resolve({ label, code: 'stayed_open' }); } }, 2500);
  });
}
const results = [];
results.push(await attempt('the gateway secret used directly as a browser token', SECRET));
results.push(await attempt('random garbage', 'nonsense'));
const expired = await mintDialerToken({ callId: 'call_x', secret: SECRET, now: Date.now() - 600_000 });
results.push(await attempt('an expired token', expired));
const foreign = await mintDialerToken({ callId: 'call_x', secret: 'a-different-secret' });
results.push(await attempt('a token signed with the wrong secret', foreign));
for (const r of results) console.log(` ${r.code === 1008 ? '✅' : '❌'} ${r.label} → ${r.code} ${r.reason ?? ''}`);
