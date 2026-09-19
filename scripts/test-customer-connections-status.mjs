import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as numbers from '../lib/number-connection.ts';
import * as status from '../lib/public-status.ts';
import * as health from '../lib/service-health.ts';
import { costPerMinute } from '../lib/unit-economics.ts';
import { AGENT_PRESETS } from '../lib/agent-presets.ts';
import { SELECTABLE_TOOLS, MANDATORY_TOOL_NAMES } from '../lib/agent-tool-catalog.ts';

let checks=0;
function eq(actual, expected) { assert.deepEqual(actual,expected); checks++; }
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(`CREATE TABLE phone_numbers (id TEXT PRIMARY KEY, organization_id TEXT, phone_number TEXT, country TEXT, number_type TEXT, acquisition_type TEXT, public_provider_name TEXT, provider_code TEXT, connection_mode TEXT, onboarding_status TEXT, direction TEXT, kyc_status TEXT, status TEXT, monthly_rental INTEGER, assigned_agent_name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE integration_connections (organization_id TEXT, type TEXT, public_config_json TEXT, encrypted_secret TEXT);
CREATE TABLE public_status_updates (id TEXT PRIMARY KEY, component TEXT, title TEXT, message TEXT, state TEXT, starts_at TEXT, ends_at TEXT, created_by TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
const db={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args)??null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return sqlite.prepare(sql).run(...args);}};}};
let organizationId='org_one', deny=false, limit=true, providerCalls=0, providerPayload={}, providerHttp=200;
let measurements=[];
const audit=[];
const session=()=>({organizationId,userId:'user_one'});
const auth=async()=>deny?{response:Response.json({error:'Forbidden'},{status:403})}:{session:session()};
const modules={
  'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
  '@/db/index':{getRawDb:()=>db},
  '@/db/bootstrap':{ensureSchema:async()=>{}},
  '@/lib/api-session':{requireCustomer:auth},
  '@/lib/customer-rbac':{requireCustomerPermission:async(_request,permission)=>{eq(permission,'telephony.manage');return auth();}},
  '@/lib/admin-rbac':{requireAdminCapability:async(_request,capability)=>{eq(capability,'providers.manage');return auth();}},
  '@/lib/plan-limits':{checkPlanLimit:async()=>({allowed:limit})},
  '@/lib/security':{decryptSecret:async value=>value},
  '@/lib/demo-seed':{recordAudit:async(...args)=>audit.push(args)},
  '@/lib/number-connection':numbers,
  '@/lib/public-status':status,
  '@/lib/service-health':health,
  '@/lib/health-center':{healthReport:async()=>({components:measurements,measuredAt:new Date().toISOString(),windowMinutes:60})},
};
function load(file){const exports={};compileFunction(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,['require','exports','fetch'])(id=>{if(!modules[id])throw Error(id);return modules[id];},exports,async(url,options)=>{providerCalls++;eq(new URL(url).hostname,'api.twilio.com');eq(options.redirect,'error');eq(options.headers.authorization,`Basic ${btoa('AC12345:test-token')}`);return Response.json(providerPayload,{status:providerHttp});});return exports;}
const numberApi=load('../app/api/app/numbers/route.ts');
const verifyApi=load('../app/api/app/numbers/verify/route.ts');
const adminStatus=load('../app/api/admin/status/route.ts');
const publicStatus=load('../app/api/status/route.ts');
const req=body=>new Request('http://localhost/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const input={action:'connect',phoneNumber:'+12025550123',providerCode:'twilio'};
deny=true;
eq((await numberApi.POST(req(input))).status,403);
deny=false;
eq((await numberApi.POST(req({...input,action:'buy'}))).status,400);
eq((await numberApi.POST(req({...input,phoneNumber:'123'}))).status,400);
eq((await numberApi.POST(req({...input,direction:'invalid'}))).status,400);
limit=false;eq((await numberApi.POST(req(input))).status,409);limit=true;
const created=await numberApi.POST(req(input));eq(created.status,201);
const id=(await created.json()).number.id;
const saved=sqlite.prepare('SELECT * FROM phone_numbers WHERE id=?').get(id);
eq(saved.status,'pending_connection');eq(saved.kyc_status,'provider_managed');eq(saved.monthly_rental,0);eq(saved.acquisition_type,'bring_your_own');
eq((await numberApi.POST(req(input))).status,409);
organizationId='org_two';eq((await (await numberApi.GET(req({}))).json()).numbers.length,0);
eq((await verifyApi.POST(req({numberId:id}))).status,404);eq(providerCalls,0);
organizationId='org_one';eq((await verifyApi.POST(req({numberId:id}))).status,409);eq(providerCalls,0);
sqlite.prepare('INSERT INTO integration_connections VALUES (?,?,?,?)').run('org_one','telephony_twilio',JSON.stringify({accountId:'AC12345'}),JSON.stringify({apiKey:'test-token'}));
providerPayload={incoming_phone_numbers:[null,{phone_number:'+12025550124',sid:'PN-other',capabilities:{voice:true}}]};
eq((await verifyApi.POST(req({numberId:id}))).status,409);
eq(sqlite.prepare('SELECT status FROM phone_numbers WHERE id=?').get(id).status,'pending_connection');
providerPayload={incoming_phone_numbers:[{phone_number:input.phoneNumber,sid:'PN-test',capabilities:{voice:false}}]};
eq((await verifyApi.POST(req({numberId:id}))).status,409);
providerPayload.incoming_phone_numbers[0].capabilities.voice=true;
eq((await verifyApi.POST(req({numberId:id}))).status,200);
eq(sqlite.prepare('SELECT status FROM phone_numbers WHERE id=?').get(id).status,'routing_required');
sqlite.prepare("UPDATE phone_numbers SET status='active' WHERE id=?").run(id);
eq((await verifyApi.POST(req({numberId:id}))).status,200);
eq(sqlite.prepare('SELECT status FROM phone_numbers WHERE id=?').get(id).status,'active');
providerHttp=401;eq((await verifyApi.POST(req({numberId:id}))).status,502);
eq(numbers.numberOwnershipProbe('twilio','../injected',input.phoneNumber),null);
eq(numbers.numberOwnershipProbe('vobiz','AC12345',input.phoneNumber),null);
eq(numbers.ownsProviderNumber('plivo',{number:'12025550123',voice_enabled:true,resource_uri:'/number/'},input.phoneNumber),true);
eq(numbers.ownsProviderNumber('plivo',{number:'12025550123',voice_enabled:false,resource_uri:'/number/'},input.phoneNumber),false);
eq(numbers.numberConnectionLabel('kyc_review'),'Provider setup required');

// Public status never exposes account identifiers, raw errors or provider keys.
const sample=(component,state)=>({component,state,reason:'SECRET ACCOUNT ERROR',errorRate:0,p95LatencyMs:null,lastSuccessAt:null,tokenState:'none',breaker:'closed',quotaUsedFraction:null});
measurements=[sample('openai','unknown'),sample('provider_openai','unhealthy'),sample('database','healthy'),sample('org_one_private_provider','unhealthy')];
const initial=await (await publicStatus.GET()).json();
eq(initial.components.find(c=>c.id==='openai').state,'unhealthy');
eq(JSON.stringify(initial).includes('SECRET ACCOUNT'),false);eq(JSON.stringify(initial).includes('org_one'),false);
eq(health.classifyService({component:'x',total:0,failures:0,p95LatencyMs:null}).p95LatencyMs,null);
const now=Date.now(), future=new Date(now+3600000).toISOString(), past=new Date(now-3600000).toISOString();
const payload={component:'whatsapp',title:'Synthetic maintenance',message:'Local verification only.',state:'scheduled',startsAt:future,endsAt:new Date(now+7200000).toISOString()};
deny=true;eq((await adminStatus.POST(req(payload))).status,403);deny=false;
eq((await adminStatus.POST(req({...payload,endsAt:''}))).status,400);
eq((await adminStatus.POST(req({...payload,component:'org_one_private_provider'}))).status,400);
eq((await adminStatus.POST(req({...payload,title:''}))).status,400);
eq((await adminStatus.POST(req({...payload,endsAt:past}))).status,400);
const statusId=(await (await adminStatus.POST(req(payload))).json()).id;
let report=await (await publicStatus.GET()).json();
eq(report.components.find(c=>c.id==='whatsapp').state,'unknown');eq(report.updates[0].title,payload.title);
eq((await adminStatus.POST(req({...payload,id:statusId,startsAt:past}))).status,200);
report=await (await publicStatus.GET()).json();eq(report.components.find(c=>c.id==='whatsapp').state,'maintenance');
eq((await adminStatus.POST(req({...payload,id:statusId,state:'resolved',startsAt:past}))).status,200);
report=await (await publicStatus.GET()).json();eq(report.components.find(c=>c.id==='whatsapp').state,'unknown');eq(report.updates[0].state,'resolved');
eq((await adminStatus.POST(req({...payload,id:'does-not-exist'}))).status,404);
const incident={id:'x',component:'platform',state:'maintenance',starts_at:past,ends_at:future};
eq(status.applyStatusUpdates(status.publicComponents(measurements),[incident],now).find(c=>c.id==='openai').state,'unhealthy');
eq(status.applyStatusUpdates(status.publicComponents([]),[{...incident,state:'resolved'}],now).every(c=>c.state==='unknown'),true);
eq(status.applyStatusUpdates(status.publicComponents([]),[{...incident,ends_at:past}],now).every(c=>c.state==='unknown'),true);
// Customer-owned carrier cost must not reduce platform margin twice.
const rates=(category)=>category==='telephony'?999999:100000;
const managed=costPerMinute(rates), byo=costPerMinute(rates,undefined,'customer');
eq(managed.micros-byo.micros,999999);eq(byo.components.find(c=>c.key==='telephony').micros,0);
eq(costPerMinute(()=>null,undefined,'customer').complete,false);
const sales=AGENT_PRESETS.find(p=>p.id==='sales_development');
eq(sales.conversationStages.length,6);
const tools=new Set([...MANDATORY_TOOL_NAMES,...SELECTABLE_TOOLS.map(t=>t.name)]);
eq(sales.tools.every(t=>tools.has(t)),true);
eq(sales.extractions.includes('buying_intent'),true);
eq(audit.length>0,true);
sqlite.close();
console.log(`customer connections and status: ${checks} assertions passed; SQLite isolated; no real provider contacted.`);
