import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dialer = readFileSync(
  new URL('../components/customer-dialer.tsx', import.meta.url),
  'utf8',
);
const compliance = readFileSync(
  new URL('../app/api/app/compliance/route.ts', import.meta.url),
  'utf8',
);

let assertions = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  assertions++;
};

check(
  dialer.includes('Browser AI test') && dialer.includes('Real carrier call'),
  'Browser testing and real carrier calling are visibly distinct',
);
check(
  dialer.includes(
    'const [carrierConsentConfirmed, setCarrierConsentConfirmed] = useState(false);',
  ) && dialer.includes('checked={carrierConsentConfirmed}'),
  'Outbound consent starts unchecked and is controlled explicitly',
);
const suppression = dialer.indexOf("action: 'check_suppression'");
const grant = dialer.indexOf("action: 'grant_consent'");
const call = dialer.indexOf("fetch('/api/app/calls'");
check(
  suppression > -1 && grant > suppression && call > grant,
  'Suppression and consent checks happen before the billable call mutation',
);
check(
  dialer.includes('/api/app/calls/${encodeURIComponent(carrierCallId)}') &&
    dialer.includes('TERMINAL_CARRIER_STATUSES'),
  'Created calls are polled until the server reports a terminal state',
);
check(
  dialer.includes('This rings the contact') &&
    dialer.includes('spends\n              wallet credits'),
  'The UI truthfully explains that carrier calls ring a person and spend credits',
);
check(
  compliance.includes(
    'SELECT id, status, purpose, captured_at, expires_at FROM consent_records',
  ),
  'Suppression lookup returns the consent id needed for safe reuse',
);
check(!dialer.includes('7510020067'), 'No personal destination is hardcoded');

console.log(`Customer carrier dialer: ${assertions} assertions passed.`);
