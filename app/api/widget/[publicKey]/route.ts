import { getRawDb } from '@/db/index';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicKey: string }> },
) {
  const { publicKey } = await params;
  const form = await getRawDb()
    .prepare(`SELECT name, fields_json, settings_json, status
    FROM lead_forms WHERE public_key = ? LIMIT 1`)
    .bind(publicKey)
    .first<{
      name: string;
      fields_json: string;
      settings_json: string;
      status: string;
    }>();
  if (!form || form.status !== 'active')
    return new Response('/* Vaani form is not published. */', {
      status: 404,
      headers: scriptHeaders(),
    });
  const origin = new URL(request.url).origin;
  const payload = JSON.stringify({
    publicKey,
    endpoint: `${origin}/api/forms/${publicKey}/leads`,
    fields: safeArray(form.fields_json),
    settings: safeObject(form.settings_json),
  }).replaceAll('</script', '<\\/script');
  return new Response(widgetSource(payload), { headers: scriptHeaders() });
}

function widgetSource(payload: string) {
  return `(()=>{const c=${payload},s=c.settings||{},k='vaani_form_'+c.publicKey;let shown=false;
const seen=()=>s.frequency==='once_session'?sessionStorage.getItem(k):s.frequency==='once_7_days'&&Number(localStorage.getItem(k)||0)>Date.now()-604800000;
const mark=()=>{if(s.frequency==='once_session')sessionStorage.setItem(k,'1');if(s.frequency==='once_7_days')localStorage.setItem(k,String(Date.now()))};
const esc=v=>String(v||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function open(){if(shown||seen())return;shown=true;mark();const host=document.createElement('div');host.id='vaani-lead-form';const root=host.attachShadow({mode:'open'});document.body.appendChild(host);
const modal=s.placement==='center_modal',left=s.placement==='bottom_left';root.innerHTML='<style>:host{all:initial}.v{position:fixed;z-index:2147483000;'+(modal?'inset:0;display:grid;place-items:center;background:rgba(3,6,12,.62);backdrop-filter:blur(7px)':(left?'left:22px':'right:22px')+';bottom:22px')+'}.c{box-sizing:border-box;width:min(380px,calc(100vw - 28px));border:1px solid rgba(255,255,255,.14);border-radius:22px;background:'+esc(s.background||'#0b0f17')+';color:#fff;padding:22px;box-shadow:0 26px 90px rgba(0,0,0,.48);font:14px/1.45 ui-sans-serif,system-ui;animation:'+esc(s.animation||'slide')+' .35s ease-out}.x{float:right;border:0;background:transparent;color:#9ca3af;font-size:20px;cursor:pointer}.h{font-size:20px;font-weight:700;margin:2px 28px 6px 0}.p{color:#a8b0bf;font-size:12px;margin:0 0 16px}.f{display:grid;gap:10px}.i{box-sizing:border-box;width:100%;height:42px;border:1px solid rgba(255,255,255,.12);border-radius:11px;background:rgba(255,255,255,.055);color:#fff;padding:0 12px;outline:none}.i:focus{border-color:'+esc(s.accent||'#9eb0ff')+'}.b{height:44px;border:0;border-radius:12px;background:'+esc(s.accent||'#9eb0ff')+';color:#070a10;font-weight:750;cursor:pointer}.n{min-height:18px;color:#a7f3d0;font-size:11px}@keyframes slide{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}@keyframes fade{from{opacity:0}to{opacity:1}}@keyframes bounce{0%{opacity:0;transform:scale(.88)}70%{transform:scale(1.03)}100%{opacity:1;transform:none}}@media(max-width:520px){.v{left:14px!important;right:14px!important;bottom:14px!important}.c{width:100%}}</style><div class="v"><div class="c"><button class="x" aria-label="Close">×</button><div class="h">'+esc(s.title||'Let us call you back')+'</div><p class="p">'+esc(s.description||'Share your details.')+'</p><form class="f">'+c.fields.map(f=>'<input class="i" name="'+esc(f.key)+'" placeholder="'+esc(f.label)+(f.required?' *':'')+'" '+(f.required?'required':'')+'>').join('')+'<button class="b" type="submit">'+esc(s.buttonText||'Request a call')+'</button><div class="n" aria-live="polite"></div></form></div></div>';
root.querySelector('.x').onclick=()=>host.remove();root.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=root.querySelector('.b'),n=root.querySelector('.n');b.disabled=true;n.textContent='Sending…';try{const body=Object.fromEntries(new FormData(e.target));body.pageUrl=location.href;body.campaignName=document.title;const r=await fetch(c.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const p=await r.json();if(!r.ok)throw Error(p.error||'Could not submit');n.textContent=s.successMessage||'Thanks — request received.';e.target.reset();setTimeout(()=>host.remove(),2200)}catch(x){n.style.color='#fecaca';n.textContent=x.message||'Please try again.'}finally{b.disabled=false}}}
window.VaaniLeadForm={open};if(s.placement==='inline'){console.warn('Vaani inline placement needs a manual open call.');return}if(s.trigger==='manual')return;if(s.trigger==='exit_intent'){document.addEventListener('mouseout',e=>{if(e.clientY<=0)open()},{once:true});return}setTimeout(open,Math.max(0,Number(s.delaySeconds||0))*1000)})();`;
}

function safeObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}
function safeArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function scriptHeaders() {
  return {
    'content-type': 'application/javascript; charset=utf-8',
    'cache-control': 'public, max-age=60, stale-while-revalidate=300',
    'x-content-type-options': 'nosniff',
  };
}
