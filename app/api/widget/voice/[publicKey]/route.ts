import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { isWidgetMode, normaliseBranding } from '@/lib/web-widget';

export const dynamic = 'force-dynamic';

/**
 * The embeddable script (§8).
 *
 * One `<script>` tag on the customer's own site. Everything renders inside a
 * shadow root with `all: initial`, so the host page's CSS cannot bleed in and
 * the widget's cannot bleed out — the same approach the lead-capture widget
 * already uses.
 *
 * Three things this deliberately does *not* do.
 *
 * It does not ask for the microphone on page load. §8 asks for "browser
 * microphone permission with clear prompt", and a permission dialog that
 * appears before the visitor has expressed any interest is how a site gets
 * permanently blocked in that browser. The prompt comes after they press Talk,
 * with the reason on screen.
 *
 * It does not hide the fallback when voice fails. Whatever the reason — out of
 * credits, past the cap, microphone refused, no gateway — the callback form is
 * still there. A widget that offers "leave your number" and then fails for the
 * same reason the call did has offered nothing.
 *
 * It does not claim anything happened that did not. A queued callback says
 * somebody will call, not that they have.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicKey: string }> },
) {
  const { publicKey } = await params;
  await ensureSchema();
  const widget = await getRawDb()
    .prepare(`SELECT w.status, w.modes_json, w.branding_json, o.name AS organization_name
      FROM web_widgets w JOIN organizations o ON o.id = w.organization_id
      WHERE w.public_key = ? LIMIT 1`)
    .bind(publicKey)
    .first<{
      status: string;
      modes_json: string;
      branding_json: string;
      organization_name: string;
    }>();
  if (!widget || widget.status !== 'active')
    return new Response('/* Vaani voice widget is not published. */', {
      status: 404,
      headers: scriptHeaders(),
    });

  const origin = new URL(request.url).origin;
  const branding = normaliseBranding(
    safeObject(widget.branding_json),
    widget.organization_name,
  );
  const modes = safeArray(widget.modes_json).filter(isWidgetMode);
  const config = JSON.stringify({
    publicKey,
    base: `${origin}/api/widget/voice/${encodeURIComponent(publicKey)}`,
    branding,
    modes,
  }).replaceAll('</script', '<\\/script');

  return new Response(widgetSource(config), { headers: scriptHeaders() });
}

function widgetSource(config: string) {
  return `(()=>{const C=${config},B=C.branding,M=C.modes||[];
if(!M.length)return;
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const host=document.createElement('div');host.id='vaani-voice-widget';
const root=host.attachShadow({mode:'open'});document.body.appendChild(host);
const side=B.position==='bottom_left'?'left:22px':'right:22px';
root.innerHTML='<style>:host{all:initial}*{box-sizing:border-box;font:14px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif}'
+'.launch{position:fixed;'+side+';bottom:22px;z-index:2147483000;display:flex;align-items:center;gap:9px;border:0;border-radius:999px;padding:13px 19px;background:'+esc(B.accent)+';color:#fff;font-weight:650;cursor:pointer;box-shadow:0 12px 34px rgba(0,0,0,.26)}'
+'.panel{position:fixed;'+side+';bottom:22px;z-index:2147483000;width:min(348px,calc(100vw - 28px));border-radius:18px;background:#fff;color:#111827;border:1px solid #e5e7eb;box-shadow:0 26px 80px rgba(0,0,0,.24);overflow:hidden}'
+'.hd{display:flex;align-items:center;gap:10px;padding:15px 16px;border-bottom:1px solid #e5e7eb}'
+'.lg{width:28px;height:28px;border-radius:8px;object-fit:cover}'
+'.nm{font-weight:650;font-size:13px;flex:1}'
+'.x{border:0;background:transparent;color:#6b7280;font-size:20px;cursor:pointer;line-height:1}'
+'.bd{padding:16px}.st{font-size:12px;color:#4b5563;min-height:34px}'
+'.b{width:100%;height:42px;border:0;border-radius:11px;background:'+esc(B.accent)+';color:#fff;font-weight:650;cursor:pointer;margin-top:10px}'
+'.b[disabled]{opacity:.55;cursor:default}'
+'.g{width:100%;height:40px;border:1px solid #d1d5db;border-radius:11px;background:#fff;color:#111827;cursor:pointer;margin-top:8px}'
+'.i{width:100%;height:40px;border:1px solid #d1d5db;border-radius:11px;padding:0 12px;margin-top:8px;background:#fff;color:#111827}'
+'.fine{font-size:11px;color:#6b7280;margin-top:10px}'
+'@media(prefers-color-scheme:dark){.panel{background:#111827;color:#f9fafb;border-color:#374151}.hd{border-color:#374151}.st,.fine{color:#9ca3af}.i,.g{background:#1f2937;color:#f9fafb;border-color:#374151}}'
+'</style>'
+'<button class="launch" part="launch">'+(B.logoUrl?'<img class="lg" src="'+esc(B.logoUrl)+'" alt="">':'')+esc(B.greeting)+'</button>'
+'<div class="panel" hidden><div class="hd">'+(B.logoUrl?'<img class="lg" src="'+esc(B.logoUrl)+'" alt="">':'')+'<span class="nm">'+esc(B.name)+'</span><button class="x" aria-label="Close">&times;</button></div><div class="bd"><div class="st" aria-live="polite"></div><div class="actions"></div></div></div>';

const $=s=>root.querySelector(s);
const launch=$('.launch'),panel=$('.panel'),status=$('.st'),actions=$('.actions');
let call=null;
const say=t=>{status.textContent=t};
launch.onclick=()=>{launch.hidden=true;panel.hidden=false;idle()};
$('.x').onclick=()=>{stop();panel.hidden=true;launch.hidden=false};

function idle(){
  actions.innerHTML='';
  if(M.includes('voice')){const b=document.createElement('button');b.className='b';b.textContent='Talk to us';b.onclick=talk;actions.appendChild(b)}
  if(M.includes('callback')){const g=document.createElement('button');g.className='g';g.textContent='Ask for a call back';g.onclick=callback;actions.appendChild(g)}
  say(M.includes('voice')?'Speak to our assistant, right here in your browser.':'Leave your number and we will call you back.');
}

async function talk(){
  say('Connecting…');actions.innerHTML='';
  let session;
  try{
    const r=await fetch(C.base+'/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'voice',pageUrl:location.href})});
    session=await r.json();
  }catch(e){session={ok:false,message:'We could not reach the assistant.'}}
  // Whatever went wrong, the callback is still offered — that is the whole
  // point of having a fallback.
  if(!session.ok){say(session.message||'Not available right now.');return callbackOffer()}
  let stream;
  try{
    say('Your browser will ask for the microphone — that is how you talk to us.');
    stream=await navigator.mediaDevices.getUserMedia({audio:true});
  }catch(e){
    say('We could not use your microphone. You can still leave your number.');
    return callbackOffer();
  }
  try{
    call=await connect(session,stream);
    // The gateway can end the call from its side; the panel must not sit there
    // saying "Connected" after it has.
    onEnded=()=>{if(call){stop();say('The call ended.');idle()}};
    say('Connected. Go ahead — say hello.');
    const end=document.createElement('button');end.className='g';end.textContent='End';end.onclick=()=>{stop();idle()};
    actions.innerHTML='';actions.appendChild(end);
  }catch(e){
    stream.getTracks().forEach(t=>t.stop());
    say('The connection did not hold. You can leave your number instead.');
    callbackOffer();
  }
}

function connect(session,stream){
  return new Promise((resolve,reject)=>{
    // The gateway's own protocol, not one invented for this widget: a
    // ?carrier=browser socket, a start frame, and 20 ms base64 mulaw frames
    // at 8 kHz in both directions. The browser dialer speaks exactly this.
    const ws=new WebSocket(session.gatewayUrl+'/?carrier=browser&token='+encodeURIComponent(session.token));
    const capture=new (window.AudioContext||window.webkitAudioContext)();
    const playback=new (window.AudioContext||window.webkitAudioContext)({sampleRate:8000});
    let playAt=0,settled=false;
    const fail=e=>{if(!settled){settled=true;reject(e||new Error('connect'))}};

    ws.onopen=async()=>{
      ws.send(JSON.stringify({event:'start',encoding:'mulaw',sampleRate:8000}));
      try{
        const url=URL.createObjectURL(new Blob([WORKLET],{type:'application/javascript'}));
        try{await capture.audioWorklet.addModule(url)}finally{URL.revokeObjectURL(url)}
        const node=new AudioWorkletNode(capture,'vaani-widget-downsampler',{processorOptions:{targetRate:8000,frameSamples:160}});
        node.port.onmessage=ev=>{
          if(ws.readyState!==1)return;
          const samples=ev.data;let binary='';
          for(let i=0;i<samples.length;i++)binary+=String.fromCharCode(mu(samples[i]*32768));
          ws.send(JSON.stringify({event:'media',media:{payload:btoa(binary)}}));
        };
        capture.createMediaStreamSource(stream).connect(node);
        settled=true;
        resolve({ws,capture,playback,stream,node});
      }catch(e){fail(e)}
    };
    ws.onerror=()=>fail();
    ws.onclose=ev=>{
      fail(new Error(ev.reason||'closed'));
      if(typeof onEnded==='function')onEnded(ev);
    };
    ws.onmessage=m=>{
      let frame;try{frame=JSON.parse(String(m.data))}catch(e){return}
      // Barge-in: drop anything scheduled but not yet heard.
      if(frame.event==='clear'){playAt=0;return}
      if(frame.event!=='media'||!frame.media||!frame.media.payload)return;
      try{
        const bytes=atob(frame.media.payload);
        const buf=playback.createBuffer(1,bytes.length,8000),ch=buf.getChannelData(0);
        for(let i=0;i<bytes.length;i++)ch[i]=unmu(bytes.charCodeAt(i))/32768;
        const src=playback.createBufferSource();src.buffer=buf;src.connect(playback.destination);
        // Back to back, a little ahead of now, so frames neither click nor
        // arrive late.
        const at=Math.max(playback.currentTime+0.05,playAt);
        src.start(at);playAt=at+buf.duration;
      }catch(e){}
    };
  });
}

let onEnded=null;

const WORKLET='class W extends AudioWorkletProcessor{constructor(o){super();const s=o.processorOptions||{};this.t=s.targetRate||8000;this.f=s.frameSamples||160;this.c=[]}'
+'process(i){const n=i[0]&&i[0][0];if(!n)return true;const r=sampleRate/this.t;'
+'for(let k=0;k<n.length/r;k++)this.c.push(n[Math.floor(k*r)]||0);'
+'while(this.c.length>=this.f){const f=new Float32Array(this.c.splice(0,this.f));this.port.postMessage(f,[f.buffer])}return true}}'
+"registerProcessor('vaani-widget-downsampler',W);";

/** Signed 16-bit sample to a mulaw byte (G.711), same as the dialer's. */
function mu(sample){
  const BIAS=0x84,CLIP=32635;
  let v=Math.max(-32768,Math.min(32767,Math.round(sample)));
  const sign=v<0?0x80:0;if(v<0)v=-v;if(v>CLIP)v=CLIP;v+=BIAS;
  let e=7;for(let m=0x4000;(v&m)===0&&e>0;m>>=1)e-=1;
  return ~(sign|(e<<4)|((v>>(e+3))&0x0f))&0xff;
}

function unmu(byte){
  const b=~byte&0xff,sign=b&0x80,e=(b>>4)&0x07,m=b&0x0f;
  let v=((m<<3)+0x84)<<e;v-=0x84;
  return sign?-v:v;
}

function callbackOffer(){
  if(!M.includes('callback')){actions.innerHTML='';return}
  callback();
}

function callback(){
  actions.innerHTML='';
  const name=document.createElement('input');name.className='i';name.placeholder='Your name';
  const phone=document.createElement('input');phone.className='i';phone.placeholder='Phone number';phone.type='tel';
  const send=document.createElement('button');send.className='b';send.textContent='Request a call back';
  const fine=document.createElement('p');fine.className='fine';fine.textContent='We will use this number only to call you back about this enquiry.';
  actions.append(name,phone,send,fine);
  send.onclick=async()=>{
    send.disabled=true;say('Sending…');
    try{
      const r=await fetch(C.base+'/lead',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:name.value,phone:phone.value,pageUrl:location.href})});
      const p=await r.json();
      say(p.message||(p.ok?'Thanks.':'Please check the number.'));
      if(p.ok){actions.innerHTML=''}else{send.disabled=false}
    }catch(e){say('Please try again.');send.disabled=false}
  };
}
window.VaaniVoiceWidget={open:()=>launch.click(),close:()=>{stop();panel.hidden=true;launch.hidden=false}};
})();`;
}

function scriptHeaders() {
  return {
    'content-type': 'application/javascript; charset=utf-8',
    // Short, so a workspace that pauses its widget or changes its branding is
    // not fighting a day-long cache on somebody else's site.
    'cache-control': 'public, max-age=300',
    'access-control-allow-origin': '*',
  };
}

function safeObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function safeArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry: unknown): entry is string => typeof entry === 'string',
        )
      : [];
  } catch {
    return [];
  }
}
