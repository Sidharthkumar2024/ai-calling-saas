import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import { createOpaqueToken, sha256 } from '../lib/security.ts';

// Exercise the actual callback with an isolated database and synthetic Google
// replies. Never contact Google, use real secrets, or alter a workspace account.
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`
  CREATE TABLE app_users(id TEXT PRIMARY KEY, email TEXT, role TEXT, status TEXT);
  CREATE TABLE user_security_settings(user_id TEXT PRIMARY KEY, mfa_enabled INTEGER DEFAULT 0, email_verified_at TEXT, updated_at TEXT);
  CREATE TABLE auth_provider_settings(provider TEXT PRIMARY KEY, enabled INTEGER, status TEXT, public_config_json TEXT DEFAULT '{}', encrypted_secret TEXT);
  CREATE TABLE oauth_states(id TEXT PRIMARY KEY, provider TEXT, state_hash TEXT, code_verifier_encrypted TEXT, return_to TEXT, expires_at TEXT, consumed_at TEXT);
  CREATE TABLE auth_sessions(id TEXT PRIMARY KEY, user_id TEXT, token_hash TEXT, expires_at TEXT);
  CREATE TABLE oauth_identities(id TEXT PRIMARY KEY, provider TEXT, subject TEXT, user_id TEXT, email TEXT);
  CREATE UNIQUE INDEX oauth_identity_subject ON oauth_identities(provider,subject);
  CREATE UNIQUE INDEX oauth_identity_user ON oauth_identities(provider,user_id);
  CREATE TABLE oauth_account_links(id TEXT PRIMARY KEY, provider TEXT, user_id TEXT, email TEXT, expires_at TEXT, consumed_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
function statement(sql, args = []) {
  return {
    sql, args,
    bind(...values) { return statement(sql, values); },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
  };
}
const db = {
  prepare: statement,
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const results = statements.map(({ sql, args }) => sqlite.prepare(sql).run(...args));
      sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  },
};
const modules = {
  'next/server': { NextResponse: { redirect: (url) => new Response(null, { status: 307, headers: { Location: String(url) } }) } },
  '@/db/bootstrap': { ensureSchema: async () => {} },
  '@/db/index': { getRawDb: () => db },
  '@/lib/app-auth': { sessionCookie: (token) => `vani_session=${token}; Path=/; HttpOnly` },
  '@/lib/security': { createOpaqueToken, sha256, decryptSecret: async value => value === 'encrypted-client-secret' ? 'stored-client-secret' : 'isolated-pkce' },
};
const testProcess = { env: { GOOGLE_CLIENT_ID: 'isolated-client', GOOGLE_CLIENT_SECRET: 'isolated-secret', GOOGLE_REDIRECT_URI: 'http://localhost/api/auth/google/callback' } };
const configModule = {};
compileFunction(ts.transpileModule(readFileSync(new URL('../lib/google-auth-config.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, ['require', 'exports', 'process'])(id => modules[id], configModule, testProcess);
modules['@/lib/google-auth-config'] = configModule;
let fetchCount = 0;
let identity;
const syntheticFetch = async (url) => {
  fetchCount++;
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ id_token: 'synthetic-token' });
  assert.equal(url, 'https://oauth2.googleapis.com/tokeninfo?id_token=synthetic-token');
  return Response.json(identity);
};
const route = {};
const source = readFileSync(new URL('../app/api/auth/google/callback/route.ts', import.meta.url), 'utf8');
compileFunction(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  ['require', 'exports', 'fetch', 'process'])((id) => {
    if (!(id in modules)) throw new Error(`Unexpected dependency ${id}`);
    return modules[id];
  }, route, syntheticFetch, testProcess);

const stateHash = await sha256('test-state');
const verifiedAt = '2026-01-01T00:00:00.000Z';
async function reset({ verified = verifiedAt, securityRow = true, mfa = 0, role = 'owner', portal = '/app', status = 'active', enabled = 1 } = {}) {
  sqlite.exec('DELETE FROM app_users; DELETE FROM user_security_settings; DELETE FROM auth_sessions; DELETE FROM oauth_states; DELETE FROM auth_provider_settings; DELETE FROM oauth_identities; DELETE FROM oauth_account_links;');
  sqlite.prepare('INSERT INTO app_users VALUES (?,?,?,?)').run('user_test', 'owner@example.test', role, status);
  if (securityRow) sqlite.prepare('INSERT INTO user_security_settings(user_id,mfa_enabled,email_verified_at) VALUES (?,?,?)').run('user_test', mfa, verified);
  sqlite.prepare('INSERT INTO auth_provider_settings(provider,enabled,status) VALUES (?,?,?)').run('google', enabled, 'active');
  sqlite.prepare('INSERT INTO oauth_states VALUES (?,?,?,?,?,?,NULL)').run('oauth_test', 'google', stateHash, 'synthetic-encrypted-value', portal, new Date(Date.now() + 60_000).toISOString());
  identity = { aud: 'isolated-client', iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 3600), email: 'owner@example.test', email_verified: 'true', sub: 'synthetic-google-subject' };
  fetchCount = 0;
}
const callback = (cookie = `vani_oauth_state=${stateHash}`) => route.GET(new Request('http://localhost/api/auth/google/callback?state=test-state&code=synthetic-code', { headers: { cookie } }));
const sessionCount = () => sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n;
let checks = 0;
function equal(actual, expected) { assert.equal(actual, expected); checks++; }
function redirectError(response, error) {
  equal(new URL(response.headers.get('Location')).searchParams.get('error'), error);
  equal(sessionCount(), 0);
  equal(response.headers.get('Set-Cookie'), null);
}

for (const options of [{ securityRow: false }, { verified: null }, { verified: '' }]) {
  await reset(options);
  redirectError(await callback(), 'google_verification_required');
  equal(sqlite.prepare('SELECT email_verified_at FROM user_security_settings').get()?.email_verified_at, options.securityRow === false ? undefined : options.verified);
}
await reset({ verified: null });
sqlite.prepare(`INSERT INTO oauth_account_links(id,provider,user_id,email,expires_at)
  VALUES ('link','google','user_test','owner@example.test',datetime('now','+1 hour'))`).run();
const firstGoogleLogin = await callback();
equal(new URL(firstGoogleLogin.headers.get('Location')).pathname, '/app');
equal(sessionCount(), 1);
equal(sqlite.prepare('SELECT COUNT(*) AS n FROM oauth_identities').get().n, 1);
equal(Boolean(sqlite.prepare('SELECT email_verified_at FROM user_security_settings').get().email_verified_at), true);
equal(Boolean(sqlite.prepare('SELECT consumed_at FROM oauth_account_links').get().consumed_at), true);
await reset();
const success = await callback();
equal(new URL(success.headers.get('Location')).pathname, '/app');
equal(sessionCount(), 1);
equal(success.headers.get('Set-Cookie').includes('vani_session='), true);
equal(success.headers.get('Set-Cookie').includes('Max-Age=0'), true);
equal(sqlite.prepare('SELECT email_verified_at FROM user_security_settings').get().email_verified_at, verifiedAt);
equal(fetchCount, 2);
const replay = await callback();
equal(new URL(replay.headers.get('Location')).searchParams.get('error'), 'google_state');
equal(sessionCount(), 1);
equal(fetchCount, 2);

await reset({ mfa: 1 });
redirectError(await callback(), 'google_mfa_use_password');
for (const cookie of ['', 'vani_oauth_state=wrong']) {
  await reset();
  redirectError(await callback(cookie), 'google_state');
  equal(fetchCount, 0);
}
await reset({ enabled: 0 });
redirectError(await callback(), 'google_disabled');
equal(fetchCount, 0);
await reset();
identity.email = 'unknown@example.test';
redirectError(await callback(), 'google_account_required');
await reset({ status: 'suspended' });
redirectError(await callback(), 'google_account_required');
await reset({ portal: '/admin' });
redirectError(await callback(), 'wrong_portal');
await reset({ role: 'platform_admin', portal: '/admin' });
equal(new URL((await callback()).headers.get('Location')).pathname, '/admin');
equal(sessionCount(), 1);
for (const patch of [{ sub: undefined }, { email_verified: 'false' }, { aud: 'other-client' }, { exp: '1' }, { iss: 'https://not-google.test' }]) {
  await reset();
  Object.assign(identity, patch);
  redirectError(await callback(), 'google_identity');
}
await reset();
sqlite.prepare('UPDATE auth_provider_settings SET public_config_json = ?, encrypted_secret = ?').run(JSON.stringify({ clientId: 'stored-client', redirectUri: 'http://localhost/api/auth/google/callback' }), 'encrypted-client-secret');
identity.aud = 'stored-client';
equal((await configModule.googleAuthConfig()).clientSecret, 'stored-client-secret');
equal(new URL((await callback()).headers.get('Location')).pathname, '/app');
equal(sessionCount(), 1);
await reset();
testProcess.env = {};
sqlite.prepare('UPDATE auth_provider_settings SET public_config_json = ?, encrypted_secret = ?').run(JSON.stringify({ clientId: 'stored-client', redirectUri: 'http://localhost/api/auth/google/callback' }), 'encrypted-client-secret');
identity.aud = 'stored-client';
equal(new URL((await callback()).headers.get('Location')).pathname, '/app');
equal(sessionCount(), 1);
await reset();
testProcess.env = { GOOGLE_CLIENT_ID: 'env-client', GOOGLE_CLIENT_SECRET: 'env-secret', GOOGLE_REDIRECT_URI: 'http://localhost/api/auth/google/callback' };
for (const config of ['{broken', JSON.stringify({ clientId: 'partial' })]) {
  sqlite.prepare('UPDATE auth_provider_settings SET public_config_json = ?, encrypted_secret = NULL').run(config);
  equal(await configModule.googleAuthConfig(), null);
}
sqlite.close();
console.log(`Google callback: ${checks} assertions passed (isolated SQLite and synthetic provider responses).`);
