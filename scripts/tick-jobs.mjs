/**
 * Runs the background queue on a developer's machine.
 *
 * In production something outside this repo — a Cloudflare cron trigger, an
 * uptime service, a CI schedule — posts to `/api/internal/jobs` on a timer.
 * Nothing does that on localhost, so appointment reminders, alert rules,
 * retention, scheduled reports and campaign dialling sit queued and look
 * broken while the code that runs them is fine.
 *
 *   npm run jobs:tick            # every 60s until you stop it
 *   npm run jobs:tick -- --once  # one tick and exit
 *   npm run jobs:tick -- --every 15
 *
 * The secret is read from `.env.local` and sent as a header. It is never
 * printed, and this script only ever talks to the host you pass it, which
 * defaults to localhost.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

const base = flag('host', 'http://localhost:3000').replace(/\/$/, '');
const every = Math.max(5, Number(flag('every', 60)) || 60);
const once = args.includes('--once');

function cronSecret() {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
  try {
    const file = readFileSync('.env.local', 'utf8');
    const line = file
      .split('\n')
      .find((entry) => entry.startsWith('CRON_SECRET='));
    return line ? line.slice('CRON_SECRET='.length).trim() : '';
  } catch {
    return '';
  }
}

const secret = cronSecret();
if (!secret) {
  // Without it the endpoint asks for an admin session instead, which a script
  // cannot supply. Say so rather than looping on 401s.
  console.error(
    'No CRON_SECRET found in the environment or .env.local.\n' +
      'The jobs endpoint falls back to requiring an admin session, which this\n' +
      'script cannot provide. Set CRON_SECRET and try again.',
  );
  process.exit(1);
}

let ticks = 0;

async function tick() {
  ticks += 1;
  const at = new Date().toLocaleTimeString();
  try {
    const response = await fetch(`${base}/api/internal/jobs`, {
      method: 'POST',
      headers: { 'x-vaani-cron-secret': secret },
    });
    if (!response.ok) {
      console.log(`${at}  ${response.status} ${response.statusText}`);
      return;
    }
    const body = await response.json();
    const processed = Array.isArray(body.processed) ? body.processed : [];
    const failed = processed.filter((job) => job.status !== 'completed');
    // A quiet queue should stay quiet: a line per tick saying "nothing to do"
    // is how a developer learns to stop reading the output.
    if (processed.length === 0 && !body.queued) return;
    console.log(
      `${at}  queued ${body.queued ?? 0}  ran ${processed.length}` +
        (failed.length ? `  failed ${failed.length}` : ''),
    );
    for (const job of failed)
      console.log(`         ${job.id} ${job.status} ${job.error ?? ''}`);
  } catch (error) {
    console.log(
      `${at}  could not reach ${base} — is the dev server running? (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
}

await tick();
if (!once) {
  console.log(
    `Ticking ${base}/api/internal/jobs every ${every}s. Ctrl+C to stop.`,
  );
  setInterval(() => void tick(), every * 1000);
}
