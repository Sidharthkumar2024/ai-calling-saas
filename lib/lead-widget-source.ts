import type { LeadFormField } from './lead-form-fields';

export function leadWidgetSource(config: {
  publicKey: string;
  endpoint: string;
  fields: LeadFormField[];
  settings: Record<string, unknown>;
}) {
  const json = JSON.stringify(config).replaceAll('<', '\\u003c');
  return `(()=>{
const c=${json},s=c.settings||{},key='vani_form_'+c.publicKey;let host=null;
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const color=(value,fallback)=>/^#[0-9a-f]{6}$/i.test(value||'')?value:fallback;
const bg=color(s.background,'#0b0f17'),accent=color(s.accent,'#9eb0ff');
const ink=hex=>{const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]>.179?'#101b15':'#ffffff'};
const seen=()=>{try{return s.frequency==='once_session'?sessionStorage.getItem(key):s.frequency==='once_7_days'&&Number(localStorage.getItem(key)||0)>Date.now()-604800000}catch{return false}};
function mark(){try{if(s.frequency==='once_session')sessionStorage.setItem(key,'1');if(s.frequency==='once_7_days')localStorage.setItem(key,String(Date.now()))}catch{}}
function close(){host?.remove();host=null}
function open(manual=false){if(host||(!manual&&seen()))return;mark();host=document.createElement('div');host.id=key;const root=host.attachShadow({mode:'open'});document.body.appendChild(host);
const modal=s.placement==='center_modal',position=modal?'inset:0;display:grid;place-items:center;background:#0006;':(s.placement==='bottom_left'?'left:18px;':'right:18px;')+'bottom:18px;';
root.innerHTML='<style>:host{all:initial}.wrap{position:fixed;z-index:2147483000;'+position+'}.card{box-sizing:border-box;width:min(380px,calc(100vw - 28px));max-height:calc(100dvh - 40px);overflow:auto;padding:24px;border:1px solid #80808040;border-radius:24px;background:'+bg+';color:'+ink(bg)+';box-shadow:0 20px 70px #0003;font:14px/1.5 system-ui,sans-serif;animation:enter .3s ease-out}.close{float:right;border:0;background:none;color:inherit;font:22px system-ui;cursor:pointer}.logo{max-width:140px;height:40px;object-fit:contain}h2{margin:8px 24px 8px 0;font-size:23px;line-height:1.2}p{opacity:.8}form{display:grid;gap:12px}label{display:grid;gap:5px;font-size:13px}input{box-sizing:border-box;width:100%;min-height:44px;border:1px solid #8888;background:transparent;color:inherit;border-radius:10px;padding:10px;font:inherit}input:focus-visible,.send:focus-visible,.close:focus-visible{outline:2px solid '+accent+';outline-offset:3px}.send{border:0;border-radius:12px;min-height:46px;background:'+accent+';color:'+ink(accent)+';font:600 14px system-ui;cursor:pointer}.send:disabled{opacity:.5}.note{font-size:12px;margin:0}.result{min-height:20px;font-size:13px}@keyframes enter{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.card{animation:none}}</style><div class="wrap"><section class="card" aria-label="Callback request"><button class="close" aria-label="Close form">×</button>'+(s.logoUrl?'<img class="logo" alt="Business logo" referrerpolicy="no-referrer" src="'+esc(s.logoUrl)+'">':'')+'<h2>'+esc(s.title||'Let us call you back')+'</h2><p>'+esc(s.description||'Share your enquiry with our team.')+'</p><form>'+c.fields.map(f=>'<label>'+esc(f.label)+(f.required?' *':'')+'<input name="'+esc(f.key)+'" type="'+esc(f.type)+'" maxlength="1000" '+(f.required?'required':'')+'></label>').join('')+'<p class="note">By requesting a callback, you ask this business to contact you about this enquiry.</p><button class="send" type="submit">'+esc(s.buttonText||'Request a call')+'</button><div class="result" role="status"></div></form></section></div>';
const style=root.querySelector('style');style.textContent+='@keyframes fade{from{opacity:0}to{opacity:1}}@keyframes bounce{0%{opacity:0;transform:scale(.94)}70%{transform:scale(1.02)}100%{opacity:1;transform:none}}.card{animation-name:'+(['fade','bounce'].includes(s.animation)?s.animation:'enter')+'}';
root.querySelectorAll('input[type="number"]').forEach(input=>{input.step='any'});
root.querySelector('.close').onclick=close;root.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
root.querySelector('form').onsubmit=async e=>{e.preventDefault();const button=root.querySelector('.send'),status=root.querySelector('.result');button.disabled=true;status.textContent='Sending…';try{const body=Object.fromEntries(new FormData(e.target));body.pageUrl=location.origin+location.pathname;body.campaignName=document.title;const response=await fetch(c.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Error(result.error||'Could not send your request.');status.textContent=s.successMessage||'Thanks — your request was received.';e.target.reset()}catch(error){status.textContent=error.message||'Please try again.'}finally{button.disabled=false}};
}
window.VaaniLeadForms=window.VaaniLeadForms||{};window.VaaniLeadForms[c.publicKey]={open:()=>open(true),close};window.VaaniLeadForm=window.VaaniLeadForms[c.publicKey];
if(s.trigger==='manual')return;if(s.trigger==='exit_intent'){const exit=event=>{if(event.clientY<=0){document.removeEventListener('mouseout',exit);open()}};document.addEventListener('mouseout',exit);return}setTimeout(()=>open(),Math.min(120,Math.max(0,Number(s.delaySeconds??5)||0))*1000);
})();`;
}
