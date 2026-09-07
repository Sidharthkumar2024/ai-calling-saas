/**
 * Finds a write endpoint that only checks *whether* you are signed in.
 *
 * `requireCustomer` answers "is there a session"; `requireCustomerPermission`
 * answers "may this person do this". A write behind the first one is open to
 * every member of the workspace — the analyst whose role says read-only
 * included.
 *
 * This has been found by hand twice. The refunds route posted straight to
 * Razorpay behind a bare session check, bypassing the whole risk matrix in
 * `lib/action-policy.ts`. Voice profiles let any member rebind which voice an
 * agent speaks with. Both were fixed; five more were still open when this was
 * written, including the one that mints API keys.
 *
 * A route is satisfied by any of:
 *   - `requireCustomerPermission` / `requireAdminCapability` in that handler,
 *   - a signature or shared-secret check, for a provider webhook,
 *   - an entry in PUBLIC below, with a reason.
 *
 * GET is not checked. Reads have their own tenant scoping and are a different
 * question from "who may change this".
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Endpoints that must work without a session, and why.
 *
 * Every one of these is a door somebody outside the workspace walks through,
 * so each carries its own credential instead: a signed webhook, an opaque
 * token, a public key. Listed rather than inferred, because "this one is fine"
 * is exactly the judgement that should be written down.
 */
const PUBLIC = {
  'app/api/auth/login/route.ts': 'signing in is how you get a session',
  'app/api/auth/signup/route.ts': 'creating the workspace and its first member',
  'app/api/auth/logout/route.ts': 'ending a session needs only that session',
  'app/api/auth/security/route.ts': 'MFA enrolment during sign-in',
  'app/api/auth/google/callback/route.ts': 'OAuth redirect',
  'app/api/auth/google/start/route.ts': 'OAuth redirect',
  'app/api/upload/[token]/route.ts':
    'the customer has no account; the token is the credential',
  'app/api/deliver/[token]/route.ts':
    'the buyer has no account; the token is the credential',
  'app/api/forms/[publicKey]/leads/route.ts': 'an embedded public lead form',
  'app/api/widget/[publicKey]/route.ts': 'an embedded public widget',
  'app/api/widget/voice/[publicKey]/route.ts': 'an embedded public widget',
  'app/api/widget/voice/[publicKey]/session/route.ts':
    'an embedded public widget',
  'app/api/widget/voice/[publicKey]/lead/route.ts': 'an embedded public widget',
  'app/api/v1/leads/route.ts': 'the public API, authenticated by API key',
  'app/api/internal/jobs/route.ts':
    'external cron, authenticated by CRON_SECRET',
  'app/api/internal/voice-turn/route.ts':
    'the media gateway, authenticated by a shared secret',
  'app/api/chatgpt-auth/route.ts': 'OAuth redirect',
  'app/api/growth-oauth/callback/route.ts': 'OAuth redirect',
  'app/api/integrations/callback/route.ts': 'OAuth redirect',
};

// "Proves who is calling without a session." The per-workspace lead webhooks
// use `validMetaSignature` and a `webhookSecret` column rather than an env var,
// which an env-var-shaped pattern reported as wide open — it is not.
const SIGNED =
  /[Ss]ignature|constantTimeEqual|timingSafeEqual|webhookSecret|verify_token|verifyToken|APP_SECRET|WEBHOOK_SECRET|CRON_SECRET|MEDIA_GATEWAY_SECRET|sha256\(/;

/**
 * Writes that only ever touch the acting person's own row, and why.
 *
 * A workspace permission is the wrong question for these: an analyst choosing
 * their own headset or dismissing their own notification is not exercising
 * authority over anything. Listed rather than inferred, because "this one only
 * touches me" has to stay true as the handler grows.
 */
const SELF = {
  'app/api/app/diagnostics/route.ts':
    "saves this person's own device choice and their own test results",
  'app/api/app/notifications/route.ts':
    "marks this person's own notifications read; every write is scoped to their user id",
};

const files = execSync(
  "grep -rlE 'export async function (POST|PUT|PATCH|DELETE)' app/api --include='route.ts' 2>/dev/null",
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean);

const findings = [];
for (const file of files) {
  if (PUBLIC[file] || SELF[file]) continue;
  const source = readFileSync(file, 'utf8');
  // A webhook proves who is calling with a signature rather than a session.
  if (file.startsWith('app/api/webhooks/') && SIGNED.test(source)) continue;

  const lines = source.split('\n');
  for (const [index, line] of lines.entries()) {
    if (!/^export async function (POST|PUT|PATCH|DELETE)\(/.test(line))
      continue;
    // The handler's body, to the next top-level export or the end.
    let end = lines.length;
    for (let scan = index + 1; scan < lines.length; scan += 1)
      if (lines[scan].startsWith('export ')) {
        end = scan;
        break;
      }
    const body = lines.slice(index, end).join('\n');
    // `requireAnyCustomerPermission` is spelled out: it is a real permission
    // check — session, then "does this person hold one of these?" — and
    // `requireCustomerPermission` does not match it, because of the `Any` in
    // the middle. A route using it was reported as having no check at all.
    if (
      /requireCustomerPermission|requireAnyCustomerPermission|requireAdminCapability|requireSupportAccess/.test(
        body,
      )
    )
      continue;
    if (SIGNED.test(body)) continue;
    findings.push({
      file,
      handler: line.match(/function (\w+)/)?.[1] ?? '?',
      guard: /requireCustomer\(|requireAdmin\(/.test(body)
        ? 'only a session check'
        : 'no check at all',
    });
  }
}

for (const finding of findings)
  console.error(
    `UNGUARDED  ${finding.file} ${finding.handler} — ${finding.guard}. Every member of the workspace can do this, including a read-only one.`,
  );

console.log(
  `${files.length} write routes checked, ${Object.keys(PUBLIC).length} declared public, ${Object.keys(SELF).length} declared self-only, ${findings.length} unguarded`,
);
if (findings.length > 0) process.exitCode = 1;
