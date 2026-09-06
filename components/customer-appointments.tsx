'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  describeSlot,
  nextAppointmentStatuses,
  type AppointmentStatus,
} from '@/lib/appointments';

/**
 * The appointment book.
 *
 * There was no screen for this at all. `book_appointment` wrote a row, told
 * the caller it was done, and nobody at the business ever saw it — there was
 * no `UPDATE appointments` anywhere in the codebase, so nothing could be
 * cancelled, completed or marked a no-show either.
 *
 * The ordering is the point. Newest-first buried the appointment that happened
 * this morning and was never marked, which is the only row here that needs a
 * person; overdue comes first instead, and says how long it has been sitting.
 * Whether the customer was actually told is shown per row rather than assumed,
 * because "booked" and "they know about it" are different facts.
 */

type Appointment = {
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
  timing: { phase: string; minutesAway: number | null; message: string };
};

const ACTION_LABEL: Record<AppointmentStatus, string> = {
  booked: 'Reopen',
  confirmed: 'They confirmed',
  completed: 'They came',
  no_show: 'No show',
  cancelled: 'Cancel',
};

const PHASE_TONE: Record<string, string> = {
  past_due: 'text-danger-text',
  now: 'text-warning-text',
  soon: 'text-warning-text',
  upcoming: 'text-ink-muted',
  closed: 'text-ink-muted',
  unknown: 'text-danger-text',
};

/** Outcomes worth a line of explanation from whoever recorded them. */
const NEEDS_NOTE = new Set<AppointmentStatus>(['no_show', 'cancelled']);

export function CustomerAppointments() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [summary, setSummary] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/app/appointments');
    if (!response.ok) return;
    const payload = (await response.json()) as {
      appointments: Appointment[];
      summary: string;
    };
    setAppointments(payload.appointments);
    setSummary(payload.summary);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function move(appointment: Appointment, status: AppointmentStatus) {
    setProblem(null);
    const note = NEEDS_NOTE.has(status)
      ? (window.prompt(
          status === 'no_show'
            ? 'What happened? (they did not arrive, we could not reach them…)'
            : 'Why was it cancelled?',
        ) ?? '')
      : '';
    const response = await fetch('/api/app/appointments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appointmentId: appointment.id,
        status,
        note: note || undefined,
      }),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      reason?: string;
    };
    if (!payload.ok) setProblem(payload.reason ?? 'That change was refused.');
    else await load();
  }

  return (
    <div className="space-y-6">
      <section className="portal-panel p-5">
        <h2 className="text-sm font-semibold">Appointments</h2>
        <p className="mt-1 max-w-2xl text-[11px] text-ink-muted">
          Everything your agents have booked. Whoever is on the phone promised
          these, so they need an outcome — the ones whose time has passed
          without one are at the top.
        </p>
        {summary ? (
          <p className="mt-3 text-[11px] text-ink-body">{summary}</p>
        ) : null}
        {problem ? (
          <p role="alert" className="mt-2 text-[11px] text-danger-text">
            {problem}
          </p>
        ) : null}
      </section>

      <section className="portal-panel p-5">
        {appointments.length === 0 ? (
          <p className="text-[11px] text-ink-muted">
            Nothing booked yet. Appointments appear here as soon as an agent
            books one on a call.
          </p>
        ) : null}
        <div className="space-y-2">
          {appointments.map((appointment) => (
            <div
              key={appointment.id}
              className="rounded-lg border border-hairline bg-surface px-3 py-2.5"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[11px] font-medium">
                  {appointment.customer_name || 'Unnamed'}
                </span>
                {appointment.customer_phone ? (
                  <span className="text-[11px] text-ink-muted">
                    {appointment.customer_phone}
                  </span>
                ) : null}
                <span className="text-[11px] text-ink-muted">
                  {describeSlot(
                    appointment.slot_start,
                    appointment.timezone || undefined,
                  )}
                </span>
                <span
                  className={`text-[11px] ${PHASE_TONE[appointment.timing.phase] ?? 'text-ink-muted'}`}
                >
                  {appointment.timing.message}
                </span>
              </div>

              <p className="mt-1 text-[11px] text-ink-muted">
                {[
                  appointment.service,
                  appointment.mode.replace('_', ' '),
                  appointment.status.replace('_', ' '),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                {/* Said per row rather than assumed. A booking nobody was told
                    about is a booking only we know about. */}
                {' · '}
                {appointment.confirmed_at
                  ? 'confirmation sent'
                  : 'no confirmation sent'}
                {appointment.reminded_at ? ' · reminded' : ''}
              </p>

              {appointment.outcome_note ? (
                <p className="mt-1 text-[11px] text-ink-body">
                  {appointment.outcome_note}
                </p>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {nextAppointmentStatuses(appointment.status).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => void move(appointment, status)}
                    className="h-6 rounded-md border border-hairline px-2 text-[11px] text-ink-body"
                  >
                    {ACTION_LABEL[status]}
                  </button>
                ))}
                {nextAppointmentStatuses(appointment.status).length === 0 ? (
                  <span className="text-[11px] text-ink-muted">
                    Closed — a customer who turns up later gets a new booking,
                    so this record still shows that somebody waited.
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
