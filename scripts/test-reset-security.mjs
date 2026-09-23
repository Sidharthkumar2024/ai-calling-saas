import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction } from 'node:vm';
import ts from 'typescript';

const route = readFileSync(
  new URL('../app/api/auth/password-reset/route.ts', import.meta.url),
  'utf8',
);
const login = readFileSync(
  new URL('../components/portal-login.tsx', import.meta.url),
  'utf8',
);
const layout = readFileSync(
  new URL('../app/layout.tsx', import.meta.url),
  'utf8',
);
const rateLimitSource = readFileSync(
  new URL('../lib/rate-limit.ts', import.meta.url),
  'utf8',
);
const rateLimit = {};
compileFunction(
  ts.transpileModule(rateLimitSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  ['require', 'exports'],
)(
  (id) => {
    if (id === '@/db/bootstrap') return { ensureSchema: async () => {} };
    if (id === '@/db/index') return { getRawDb: () => null };
    if (id === '@/lib/security') return { sha256: async () => '' };
    throw new Error(`Unexpected dependency ${id}`);
  },
  rateLimit,
);

assert.equal(
  rateLimit.requestFingerprint(
    new Request('https://callvani.com', {
      headers: {
        'x-real-ip': '203.0.113.7',
        'x-forwarded-for': '198.51.100.1, 203.0.113.7',
      },
    }),
  ),
  '203.0.113.7:',
  'the trusted reverse-proxy address must win over a spoofable XFF prefix',
);
assert.match(route, /identifier:\s*email/);
assert.match(route, /resetUrl\.hash\s*=/);
assert.doesNotMatch(route, /resetUrl\.searchParams\.set\(['"]reset_token/);
assert.match(login, /useLayoutEffect/);
assert.doesNotMatch(login, /id=\{`\$\{portal\}-reset-token`\}/);
assert.match(layout, /referrer:\s*['"]no-referrer['"]/);

console.log('Reset security: 7 assertions passed.');
