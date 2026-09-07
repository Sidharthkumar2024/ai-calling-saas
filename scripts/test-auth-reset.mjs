import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import * as security from '../lib/security.ts';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`CREATE TABLE app_users(id TEXT PRIMARY KEY,password_hash TEXT);
CREATE TABLE auth_sessions(id TEXT PRIMARY KEY,user_id TEXT);
CREATE TABLE security_challenges(id TEXT PRIMARY KEY,user_id TEXT,type TEXT,token_hash TEXT,expires_at TEXT,consumed_at TEXT);
INSERT INTO app_users VALUES ('user_test','original');
INSERT INTO auth_sessions VALUES ('session_test','user_test');`);
let failSessionRevoke = false;
const db = {
  prepare(sql) { return { bind(...args) { return { sql,args }; } }; },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const results = statements.map(({sql,args}) => {
        if (failSessionRevoke && sql.startsWith('DELETE')) throw new Error('Injected session failure');
        return {meta:{changes:sqlite.prepare(sql).run(...args).changes}};
      });
      sqlite.exec('COMMIT'); return results;
    } catch(error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
const modules = {
  'next/server':{NextResponse:{json:(body,init) => new Response(JSON.stringify(body),init)}},
  '@/db/bootstrap':{ensureSchema:async()=>{}}, '@/db/index':{getRawDb:()=>db},
  '@/lib/rate-limit':{enforceRateLimit:async()=>({allowed:true}),requestFingerprint:()=> 'isolated-test'},
  '@/lib/security':security,
};
const exports = {};
compileFunction(ts.transpileModule(readFileSync(new URL('../app/api/auth/password-reset/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,['require','exports'])((id)=>modules[id],exports);
const confirm = (body) => exports.POST(new Request('http://localhost/api/auth/password-reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
const challenge = async (id,token) => sqlite.prepare("INSERT INTO security_challenges(id,user_id,type,token_hash,expires_at) VALUES (?,'user_test','password_reset',?,?)").run(id,await security.sha256(token),new Date(Date.now()+60000).toISOString());
await challenge('challenge_test','reset_test');
const body = {action:'confirm',token:'reset_test',password:'OnlyInMemory123'};
assert.equal((await confirm(null)).status,400);
assert.equal((await confirm({action:'confirm',password:[]})).status,400);
assert.equal((await confirm({...body,token:'invalid'})).status,400);
failSessionRevoke = true;
await assert.rejects(confirm(body),/Injected session failure/);
assert.equal(sqlite.prepare('SELECT password_hash FROM app_users').get().password_hash,'original');
assert.equal(sqlite.prepare('SELECT consumed_at FROM security_challenges').get().consumed_at,null);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,1);
failSessionRevoke = false;
assert.equal((await confirm(body)).status,200);
assert.equal(await security.verifyPassword(body.password,sqlite.prepare('SELECT password_hash FROM app_users').get().password_hash),true);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,0);
assert.equal((await confirm(body)).status,400);
sqlite.close();
console.log('Password reset: 11 assertions passed (isolated SQLite; no real password changed).');
