/**
 * How a campaign learns that one of its calls has ended.
 *
 * The dialer walks a campaign's audience through every gate a real outbound
 * call must pass, and until now it stopped there: each eligible contact was
 * recorded as blocked with the reason `origination_not_wired`, because placing
 * the call was only half of what a dialer is. The other half is this. Without
 * it a contact who answered would be dialled again on the next backoff, and
 * again, until the attempt limit ran out — the product would call a customer
 * who had already spoken to it.
 *
 * So a contact leaves `dialing` exactly once, and only when something tells it
 * how the call ended: the carrier's webhook, or the hourly sweep for a call
 * whose webhook never came.
 */

type Db = {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<{ meta?: { changes?: number } }>;
      all<T>(): Promise<{ results?: T[] }>;
    };
  };
};

export type RetryPolicy = { attempts?: number; backoffMinutes?: number[] };

/** The ceiling the dialer and this module must agree on. */
export function maxAttempts(policy: RetryPolicy) {
  return Math.min(Math.max(Number(policy.attempts ?? 3), 1), 8);
}

/**
 * How long before this contact may be called again, in minutes.
 *
 * `backoffMinutes` has been written by the campaign form since the form was
 * built — the operations route validates the list and stores it — and nothing
 * has ever read it. A customer who set "retry after 2 hours, then a day" got
 * neither, because no retry happened at all.
 *
 * Returns null when the attempts are spent, which is what says "stop calling
 * this person" rather than "call them again immediately".
 */
export function retryDelayMinutes(
  policy: RetryPolicy,
  attemptsMade: number,
): number | null {
  if (attemptsMade >= maxAttempts(policy)) return null;
  const ladder = (policy.backoffMinutes ?? [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!ladder.length) return 120;
  // The ladder is indexed by attempts already made, and its last rung repeats:
  // a policy of three attempts with one backoff should not fall back to an
  // immediate redial for the attempt it does not describe.
  return ladder[Math.min(attemptsMade - 1, ladder.length - 1)] ?? 120;
}

export function nextAttemptAt(
  policy: RetryPolicy,
  attemptsMade: number,
  now: Date,
): string | null {
  const minutes = retryDelayMinutes(policy, attemptsMade);
  return minutes === null
    ? null
    : new Date(now.getTime() + minutes * 60_000).toISOString();
}

/**
 * Whether a finished call reached the person.
 *
 * `completed` is the carrier's word for a call that was answered, and a person
 * who picked up and hung up after two seconds has still been reached: calling
 * them back because the conversation was short is harassment, not persistence.
 * Everything else — no answer, busy, failed, cancelled — is a call that never
 * happened as far as the person is concerned, and may be tried again.
 */
export function reachedTheContact(status: string) {
  return status === 'completed';
}

export type ContactSettlement = {
  settled: boolean;
  contactId?: string;
  status?: string;
  outcome?: string;
  nextAttemptAt?: string | null;
  reason?: string;
};

/**
 * Settle the campaign contact behind one finished call.
 *
 * Idempotent by construction, because carriers deliver callbacks more than
 * once and late: the write is conditional on the contact still being
 * `dialing`, so the second callback changes nothing and says so. Everything a
 * counter depends on is derived from that one conditional write — a campaign's
 * `connected` tally cannot drift past the number of contacts that actually
 * left `dialing` connected.
 */
export async function settleCampaignContactForCall(
  db: Db,
  input: { callId: string; status: string; now: Date },
): Promise<ContactSettlement> {
  const call = await db
    .prepare(
      `SELECT id, organization_id, campaign_id, campaign_contact_id
       FROM call_records WHERE id = ? LIMIT 1`,
    )
    .bind(input.callId)
    .first<{
      id: string;
      organization_id: string;
      campaign_id: string | null;
      campaign_contact_id: string | null;
    }>();
  if (!call?.campaign_contact_id)
    return { settled: false, reason: 'not_a_campaign_call' };

  const contact = await db
    .prepare(
      `SELECT cc.id, cc.status, cc.attempt_count, c.retry_policy_json
       FROM campaign_contacts cc
       JOIN campaigns c ON c.id = cc.campaign_id
       WHERE cc.id = ? AND cc.organization_id = ? LIMIT 1`,
    )
    .bind(call.campaign_contact_id, call.organization_id)
    .first<{
      id: string;
      status: string;
      attempt_count: number;
      retry_policy_json: string;
    }>();
  if (!contact) return { settled: false, reason: 'contact_not_found' };
  if (contact.status !== 'dialing')
    return {
      settled: false,
      contactId: contact.id,
      status: contact.status,
      reason: 'already_settled',
    };

  let policy: RetryPolicy = {};
  try {
    policy = JSON.parse(contact.retry_policy_json || '{}') as RetryPolicy;
  } catch {
    /* An unreadable policy is the default policy, not a reason to stop. */
  }
  const reached = reachedTheContact(input.status);
  const attemptsMade = Math.max(1, Number(contact.attempt_count ?? 1));
  const retryAt = reached
    ? null
    : nextAttemptAt(policy, attemptsMade, input.now);
  const status = reached ? 'completed' : retryAt ? 'retry' : 'exhausted';
  const outcome = reached
    ? 'connected'
    : retryAt
      ? input.status || 'not_connected'
      : 'max_attempts_reached';

  const written = await db
    .prepare(
      `UPDATE campaign_contacts SET status = ?, outcome = ?, next_attempt_at = ?, last_call_id = ?
       WHERE id = ? AND status = 'dialing'`,
    )
    .bind(status, outcome, retryAt, call.id, contact.id)
    .run();
  // Lost the race to another delivery of the same callback. Not an error, and
  // emphatically not a second increment of the campaign's connected count.
  if (!Number(written.meta?.changes ?? 0))
    return { settled: false, contactId: contact.id, reason: 'already_settled' };

  if (reached && call.campaign_id)
    await db
      .prepare(`UPDATE campaigns SET connected = connected + 1 WHERE id = ?`)
      .bind(call.campaign_id)
      .run();

  return {
    settled: true,
    contactId: contact.id,
    status,
    outcome,
    nextAttemptAt: retryAt,
  };
}

/**
 * Contacts left dialling by a call that ended without anyone saying so.
 *
 * A webhook that never arrives is not a rare case: a carrier can drop it, a
 * deploy can miss it, and a call placed while the callback URL was wrong
 * produces none at all. Every one of those leaves a contact in `dialing`,
 * which no query in the product will ever pick up again — the audience simply
 * stops shrinking and the campaign never completes.
 *
 * So the hourly sweep settles any contact whose call is already terminal, and
 * any whose call is older than the longest a call can be.
 */
export async function reconcileDialingContacts(
  db: Db,
  organizationId: string,
  staleMinutes: number,
  now: Date,
): Promise<{ reconciled: number }> {
  const cutoff = new Date(now.getTime() - staleMinutes * 60_000).toISOString();
  const stuck = await db
    .prepare(
      `SELECT cr.id AS call_id, cr.status AS call_status
       FROM campaign_contacts cc
       JOIN call_records cr ON cr.campaign_contact_id = cc.id
       WHERE cc.organization_id = ? AND cc.status = 'dialing'
         AND (cr.ended_at IS NOT NULL OR datetime(cr.started_at) <= datetime(?))
       ORDER BY cr.started_at LIMIT 200`,
    )
    .bind(organizationId, cutoff)
    .all<{ call_id: string; call_status: string }>();
  let reconciled = 0;
  for (const row of stuck.results ?? []) {
    const settlement = await settleCampaignContactForCall(db, {
      callId: row.call_id,
      // A call still marked live when its own start has aged out did not
      // reach anybody, whatever the row says.
      status: row.call_status === 'completed' ? 'completed' : 'no_answer',
      now,
    });
    if (settlement.settled) reconciled += 1;
  }
  return { reconciled };
}
