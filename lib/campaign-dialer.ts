import { getRawDb } from '@/db/index';
import { enqueueJob } from '@/lib/job-enqueue';
import { assertCanPlaceRealCall } from '@/lib/onboarding-service';
import { checkPlanLimit } from '@/lib/plan-limits';
import { sha256 } from '@/lib/security';
import { localClock, minuteOfDay } from '@/lib/shifts';

/**
 * Campaign dialer.
 *
 * Campaigns could be created and hold contacts, but nothing ever dialled them:
 * `call_jobs` had no writers and the campaign row's status never moved. This
 * walks the campaign's own contacts through the gates a real outbound call must
 * pass — consent, suppression, calling window, plan concurrency, wallet — and
 * records exactly why each contact was attempted or skipped.
 *
 * Telephony itself is gated on VOICE_STREAM_URL. When that is absent the
 * attempt is recorded as blocked rather than reported as dialled.
 */

export type DialSummary = {
  campaignId: string;
  status: string;
  considered: number;
  attempted: number;
  skipped: Record<string, number>;
  requeued: boolean;
  reason?: string;
};

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

/** Whether now falls inside the campaign's configured calling window. */
export function withinCallingWindow(
  window: { timezone?: string; start?: string; end?: string },
  at: Date,
) {
  const start = minuteOfDay(window.start ?? '10:00');
  const end = minuteOfDay(window.end ?? '19:00');
  if (start === null || end === null) return true;
  const { minuteOfDay: now } = localClock(
    at,
    window.timezone || 'Asia/Kolkata',
  );
  return end > start ? now >= start && now < end : now >= start || now < end;
}

export async function dialCampaign(
  organizationId: string,
  campaignId: string,
): Promise<DialSummary> {
  const db = getRawDb();
  const skipped: Record<string, number> = {};
  const campaign = await db
    .prepare(`SELECT id, status, agent_id, concurrency, retry_policy_json, calling_window_json
      FROM campaigns WHERE id = ? AND organization_id = ? LIMIT 1`)
    .bind(campaignId, organizationId)
    .first<{
      id: string;
      status: string;
      agent_id: string | null;
      concurrency: number;
      retry_policy_json: string;
      calling_window_json: string;
    }>();
  if (!campaign)
    return {
      campaignId,
      status: 'missing',
      considered: 0,
      attempted: 0,
      skipped,
      requeued: false,
      reason: 'campaign_not_found',
    };
  if (campaign.status !== 'running')
    return {
      campaignId,
      status: campaign.status,
      considered: 0,
      attempted: 0,
      skipped,
      requeued: false,
      reason: 'campaign_not_running',
    };

  const parse = <T>(raw: string, fallback: T): T => {
    try {
      return JSON.parse(raw || '{}') as T;
    } catch {
      return fallback;
    }
  };
  const retry = parse<{ attempts?: number; backoffMinutes?: number[] }>(
    campaign.retry_policy_json,
    {},
  );
  const window = parse<{ timezone?: string; start?: string; end?: string }>(
    campaign.calling_window_json,
    {},
  );
  const maxAttempts = Math.min(Math.max(Number(retry.attempts ?? 3), 1), 8);
  const backoff = Array.isArray(retry.backoffMinutes)
    ? retry.backoffMinutes.map((value) => Number(value)).filter(Number.isFinite)
    : [120, 1440];

  const now = new Date();
  if (!withinCallingWindow(window, now))
    return {
      campaignId,
      status: campaign.status,
      considered: 0,
      attempted: 0,
      skipped,
      // Outside the window we come back rather than dropping the campaign.
      requeued: await requeue(organizationId, campaignId, 15),
      reason: 'outside_calling_window',
    };

  // §3: a campaign is the fastest way to call a lot of real people, so it is
  // gated the same way a single outbound call is.
  const liveGate = await assertCanPlaceRealCall(organizationId);
  if (!liveGate.allowed)
    return {
      campaignId,
      status: campaign.status,
      considered: 0,
      attempted: 0,
      skipped,
      // Requeued rather than failed: the workspace is mid-setup, and the
      // campaign should start dialling once they finish rather than needing to
      // be created again.
      requeued: await requeue(organizationId, campaignId, 60),
      reason: `onboarding_incomplete:${liveGate.blockers.join('|')}`,
    };

  // Never exceed the plan's concurrency or the campaign's own setting.
  const planLimit = await checkPlanLimit(organizationId, 'concurrency', 1);
  const inFlight = await db
    .prepare(`SELECT count(*) AS live FROM call_records
      WHERE organization_id = ? AND status IN ('queued','in_progress')`)
    .bind(organizationId)
    .first<{ live: number }>();
  const ceiling = Math.min(
    Math.max(Number(campaign.concurrency ?? 1), 1),
    planLimit.limit ?? Number.MAX_SAFE_INTEGER,
  );
  const slots = Math.max(0, ceiling - Number(inFlight?.live ?? 0));
  if (slots === 0)
    return {
      campaignId,
      status: campaign.status,
      considered: 0,
      attempted: 0,
      skipped,
      requeued: await requeue(organizationId, campaignId, 2),
      reason: 'concurrency_saturated',
    };

  const wallet = await db
    .prepare(
      `SELECT balance FROM organization_wallets WHERE organization_id = ? LIMIT 1`,
    )
    .bind(organizationId)
    .first<{ balance: number }>();
  if (Number(wallet?.balance ?? 0) < 10) {
    await db
      .prepare(
        `UPDATE campaigns SET status = 'paused' WHERE id = ? AND organization_id = ?`,
      )
      .bind(campaignId, organizationId)
      .run();
    return {
      campaignId,
      status: 'paused',
      considered: 0,
      attempted: 0,
      skipped,
      requeued: false,
      reason: 'insufficient_credits',
    };
  }

  const due = await db
    .prepare(`SELECT id, phone, consent_status, attempt_count
      FROM campaign_contacts
      WHERE campaign_id = ? AND organization_id = ?
        AND status IN ('pending', 'retry')
        AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
      ORDER BY created_at LIMIT ?`)
    .bind(campaignId, organizationId, slots)
    .all<{
      id: string;
      phone: string;
      consent_status: string;
      attempt_count: number;
    }>();
  const contacts = due.results ?? [];
  let attempted = 0;
  const streamUrl = process.env.VOICE_STREAM_URL || '';
  const telephonyReady = streamUrl.startsWith('wss://');

  for (const contact of contacts) {
    // Suppression is checked per contact, because it can be added mid-campaign.
    const suppressed = await db
      .prepare(`SELECT id FROM suppression_entries
        WHERE phone_hash = ? AND (organization_id = ? OR scope = 'global')
          AND (expires_at IS NULL OR expires_at > datetime('now'))
        LIMIT 1`)
      .bind(await sha256(contact.phone), organizationId)
      .first<{ id: string }>();
    if (suppressed) {
      await settle(contact.id, 'suppressed', 'on_suppression_list');
      bump(skipped, 'suppressed');
      continue;
    }
    if (contact.consent_status !== 'granted') {
      await settle(contact.id, 'skipped', 'no_consent');
      bump(skipped, 'no_consent');
      continue;
    }
    if (Number(contact.attempt_count ?? 0) >= maxAttempts) {
      await settle(contact.id, 'exhausted', 'max_attempts_reached');
      bump(skipped, 'max_attempts');
      continue;
    }
    if (!telephonyReady) {
      // Honest: record the block, do not consume an attempt or claim a dial.
      await db
        .prepare(
          `UPDATE campaign_contacts SET status = 'blocked', outcome = 'telephony_unconfigured' WHERE id = ?`,
        )
        .bind(contact.id)
        .run();
      bump(skipped, 'telephony_unconfigured');
      continue;
    }

    const nextAttempt = Number(contact.attempt_count ?? 0) + 1;
    const delay = backoff[Math.min(nextAttempt - 1, backoff.length - 1)] ?? 120;
    await db
      .prepare(`UPDATE campaign_contacts
        SET status = 'retry', attempt_count = ?, outcome = 'dialing',
            next_attempt_at = datetime('now', ?)
        WHERE id = ?`)
      .bind(nextAttempt, `+${delay} minutes`, contact.id)
      .run();
    attempted += 1;
  }

  await db
    .prepare(`UPDATE campaigns SET attempted = attempted + ? WHERE id = ?`)
    .bind(attempted, campaignId)
    .run();

  const remaining = await db
    .prepare(`SELECT count(*) AS pending FROM campaign_contacts
      WHERE campaign_id = ? AND status IN ('pending','retry')`)
    .bind(campaignId)
    .first<{ pending: number }>();
  const pending = Number(remaining?.pending ?? 0);
  if (!pending) {
    await db
      .prepare(
        `UPDATE campaigns SET status = 'completed' WHERE id = ? AND organization_id = ?`,
      )
      .bind(campaignId, organizationId)
      .run();
    return {
      campaignId,
      status: 'completed',
      considered: contacts.length,
      attempted,
      skipped,
      requeued: false,
    };
  }
  return {
    campaignId,
    status: campaign.status,
    considered: contacts.length,
    attempted,
    skipped,
    requeued: await requeue(organizationId, campaignId, 5),
  };

  async function settle(contactId: string, status: string, outcome: string) {
    await db
      .prepare(
        `UPDATE campaign_contacts SET status = ?, outcome = ?, next_attempt_at = NULL WHERE id = ?`,
      )
      .bind(status, outcome, contactId)
      .run();
  }
}

/** Schedules the next pass. The key includes the minute so passes can repeat. */
async function requeue(
  organizationId: string,
  campaignId: string,
  minutes: number,
) {
  const at = new Date(Date.now() + minutes * 60_000);
  await enqueueJob({
    organizationId,
    queue: 'campaigns',
    type: 'campaign.dial',
    idempotencyKey: `campaign_dial:${campaignId}:${at.toISOString().slice(0, 16)}`,
    payload: { campaignId },
    availableAt: at.toISOString(),
    priority: 80,
  });
  return true;
}
