/**
 * Working the appointment book.
 *
 * Rows arrive from `book_appointment` on a live call. Until now that was the
 * whole story — nothing read the table, nothing updated it, and the customer
 * was never told anything after they hung up. This module is the rest of it:
 * listing what is booked, telling the customer it is booked, reminding them
 * before it happens, and letting a person record how it actually went.
 *
 * Messages are queued into `outbound_messages` rather than sent from here, so
 * they go out through the one delivery path that already exists and already
 * knows what to do when WhatsApp is not connected.
 */

import { getRawDb } from '@/db/index';
import {
  canMoveAppointment,
  confirmationMessage,
  isAppointmentStatus,
  needsReminder,
  queueOrder,
  queueSummary,
  reminderMessage,
  type AppointmentStatus,
} from '@/lib/appointments';
import { whatsAppConnected } from '@/lib/commerce';

type Row = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  service: string | null;
  slot_start: string;
  mode: string;
  status: string;
  timezone: string | null;
  confirmed_at: string | null;
  reminded_at: string | null;
  outcome_note: string | null;
  created_at: string;
};

const SELECT = `SELECT id, customer_name, customer_phone, service, slot_start, mode,
    status, timezone, confirmed_at, reminded_at, outcome_note, created_at
  FROM appointments`;

export async function listAppointments(organizationId: string) {
  const rows = await getRawDb()
    .prepare(
      `${SELECT} WHERE organization_id = ? ORDER BY slot_start DESC LIMIT 200`,
    )
    .bind(organizationId)
    .all<Row>();
  const list = (rows.results ?? []).map((row) => ({
    ...row,
    status: isAppointmentStatus(row.status) ? row.status : 'booked',
  }));
  return {
    // Overdue first. The default — newest booking first — buried the one that
    // happened this morning and was never marked, which is the only row that
    // needs a person.
    appointments: queueOrder(list),
    summary: queueSummary(list),
  };
}

export type AppointmentMove = { ok: boolean; reason?: string };

export async function moveAppointment(input: {
  organizationId: string;
  appointmentId: string;
  status: AppointmentStatus;
  note?: string;
  userId: string;
}): Promise<AppointmentMove> {
  const db = getRawDb();
  const row = await db
    .prepare(
      `SELECT status FROM appointments WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(input.appointmentId, input.organizationId)
    .first<{ status: string }>();
  if (!row)
    return { ok: false, reason: 'That appointment is not in this workspace.' };
  // The rules live in the pure module, so "a cancelled appointment cannot be
  // completed" holds on the server and not only on the screen.
  if (!canMoveAppointment(row.status, input.status))
    return {
      ok: false,
      reason: `An appointment that is ${row.status.replace('_', ' ')} cannot be moved to ${input.status.replace('_', ' ')}.`,
    };

  await db
    .prepare(`UPDATE appointments SET status = ?,
      confirmed_at = CASE WHEN ? = 'confirmed' THEN CURRENT_TIMESTAMP ELSE confirmed_at END,
      outcome_note = coalesce(?, outcome_note),
      updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?`)
    .bind(
      input.status,
      input.status,
      input.note?.slice(0, 300) || null,
      input.userId,
      input.appointmentId,
      input.organizationId,
    )
    .run();
  return { ok: true };
}

export type ConfirmationOutcome =
  | { sent: true; messageId: string }
  | { sent: false; reason: 'whatsapp_not_connected' | 'no_phone' };

/**
 * Tells the customer their appointment exists.
 *
 * Returns what actually happened rather than a boolean, because the caller —
 * a live agent mid-sentence — has to say something different in each case, and
 * "a confirmation is on its way" is a lie when there is no WhatsApp
 * connection.
 */
export async function queueConfirmation(input: {
  organizationId: string;
  appointmentId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  slot: string;
  service?: string | null;
  mode?: string | null;
  timezone?: string | null;
  /** Looked up when not given, so callers do not each repeat the query. */
  businessName?: string | null;
}): Promise<ConfirmationOutcome> {
  const phone = String(input.customerPhone ?? '').replace(/\D/g, '');
  if (phone.length < 6) return { sent: false, reason: 'no_phone' };
  if (!(await whatsAppConnected(input.organizationId)))
    return { sent: false, reason: 'whatsapp_not_connected' };

  const db = getRawDb();
  const business =
    input.businessName ??
    (
      await db
        .prepare(`SELECT name FROM organizations WHERE id = ? LIMIT 1`)
        .bind(input.organizationId)
        .first<{ name: string }>()
    )?.name ??
    null;
  const messageId = `msg_${crypto.randomUUID()}`;
  await db
    .prepare(`INSERT INTO outbound_messages
      (id, organization_id, channel, destination, message_body, status)
      VALUES (?, ?, 'whatsapp', ?, ?, 'queued')`)
    .bind(
      messageId,
      input.organizationId,
      phone,
      confirmationMessage({
        customerName: input.customerName,
        slot: input.slot,
        service: input.service,
        mode: input.mode,
        business,
        timezone: input.timezone,
      }),
    )
    .run();
  await db
    .prepare(
      `UPDATE appointments SET confirmation_message_id = ? WHERE id = ? AND organization_id = ?`,
    )
    .bind(messageId, input.appointmentId, input.organizationId)
    .run();
  return { sent: true, messageId };
}

/**
 * Reminds everybody whose appointment is coming up.
 *
 * Run from the job queue. `reminded_at` is written in the same pass, so a job
 * that runs twice in an hour does not message the same person twice — and a
 * workspace with no WhatsApp connection is skipped whole rather than having
 * its rows marked as reminded when nothing was sent.
 */
export async function sendDueReminders(
  organizationId: string,
  now: Date = new Date(),
) {
  const db = getRawDb();
  const rows = await db
    .prepare(
      `SELECT a.id, a.organization_id, a.customer_name, a.customer_phone, a.service,
              a.slot_start, a.mode, a.status, a.timezone, a.reminded_at, a.created_at,
              o.name AS business_name
       FROM appointments a
       JOIN organizations o ON o.id = a.organization_id
       WHERE a.organization_id = ? AND a.status IN ('booked', 'confirmed')
         AND a.reminded_at IS NULL
       ORDER BY a.slot_start LIMIT 500`,
    )
    .bind(organizationId)
    .all<Row & { organization_id: string; business_name: string | null }>();

  const due = (rows.results ?? []).filter((row) => needsReminder(row, now));
  const connected = new Map<string, boolean>();
  let sent = 0;
  let skipped = 0;

  for (const row of due) {
    const phone = String(row.customer_phone ?? '').replace(/\D/g, '');
    if (phone.length < 6) {
      skipped += 1;
      continue;
    }
    if (!connected.has(row.organization_id))
      connected.set(
        row.organization_id,
        await whatsAppConnected(row.organization_id),
      );
    if (!connected.get(row.organization_id)) {
      // Left unmarked on purpose. The appointment still needs reminding, and
      // stamping `reminded_at` would quietly record a message nobody sent.
      skipped += 1;
      continue;
    }

    const messageId = `msg_${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO outbound_messages
        (id, organization_id, channel, destination, message_body, status)
        VALUES (?, ?, 'whatsapp', ?, ?, 'queued')`)
      .bind(
        messageId,
        row.organization_id,
        phone,
        reminderMessage({
          customerName: row.customer_name,
          slot: row.slot_start,
          service: row.service,
          mode: row.mode,
          business: row.business_name,
          timezone: row.timezone,
        }),
      )
      .run();
    await db
      .prepare(
        `UPDATE appointments SET reminded_at = CURRENT_TIMESTAMP, reminder_message_id = ?
         WHERE id = ? AND reminded_at IS NULL`,
      )
      .bind(messageId, row.id)
      .run();
    sent += 1;
  }

  return { considered: due.length, sent, skipped };
}
