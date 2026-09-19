import type { HealthState, ServiceHealth } from './service-health';
export const PUBLIC_COMPONENTS = [
  { id: 'database', label: 'Platform database', group: 'Platform' },
  {
    id: 'job_queue',
    label: 'Automations & background jobs',
    group: 'Platform',
  },
  { id: 'webhooks', label: 'Webhook delivery', group: 'Platform' },
  { id: 'openai', label: 'OpenAI', group: 'AI & voice' },
  { id: 'anthropic', label: 'Anthropic', group: 'AI & voice' },
  { id: 'elevenlabs', label: 'ElevenLabs', group: 'AI & voice' },
  { id: 'deepgram', label: 'Deepgram', group: 'AI & voice' },
  { id: 'cartesia', label: 'Cartesia', group: 'AI & voice' },
  { id: 'sarvam', label: 'Sarvam', group: 'AI & voice' },
  { id: 'vobiz', label: 'Vobiz', group: 'Channels' },
  { id: 'exotel', label: 'Exotel', group: 'Channels' },
  { id: 'whatsapp', label: 'WhatsApp', group: 'Channels' },
  { id: 'razorpay', label: 'Razorpay', group: 'Payments' },
  { id: 'stripe', label: 'Stripe', group: 'Payments' },
] as const;
export const STATUS_LABEL: Record<HealthState, string> = {
  healthy: 'Operational',
  degraded: 'Degraded performance',
  unhealthy: 'Service disruption',
  unknown: 'Not measured',
  maintenance: 'Maintenance',
};
export const INCIDENT_STATES = [
  'investigating',
  'identified',
  'monitoring',
  'resolved',
  'scheduled',
  'maintenance',
] as const;
export type StatusUpdate = {
  id: string;
  component: string;
  title: string;
  message: string;
  state: string;
  starts_at: string;
  ends_at: string | null;
  updated_at: string;
};
export function publicComponents(samples: ServiceHealth[]) {
  return PUBLIC_COMPONENTS.map((component) => {
    // Either naming convention may carry traffic. Never let an unmeasured
    // alias hide an outage; where both have evidence, show the worse state.
    const priority: Record<HealthState, number> = {
      unknown: 0,
      healthy: 1,
      maintenance: 2,
      degraded: 3,
      unhealthy: 4,
    };
    const sample = samples
      .filter(
        (s) =>
          s.component === component.id ||
          s.component === `provider_${component.id}`,
      )
      .sort((a, b) => priority[b.state] - priority[a.state])[0];
    return { ...component, state: sample?.state ?? ('unknown' as HealthState) };
  });
}

export function applyStatusUpdates(
  components: ReturnType<typeof publicComponents>,
  updates: StatusUpdate[],
  now = Date.now(),
) {
  return components.map((c) => {
    const relevant = updates.filter(
      (u) =>
        (u.component === c.id || u.component === 'platform') &&
        Date.parse(u.starts_at) <= now &&
        (!u.ends_at || Date.parse(u.ends_at) > now) &&
        u.state !== 'resolved',
    );
    // Incident declarations may worsen a measurement, never hide a measured outage.
    const disrupted = relevant.some(
      (u) => u.state === 'investigating' || u.state === 'identified',
    );
    const observing = relevant.some((u) => u.state === 'monitoring');
    const maintenance = relevant.some(
      (u) => u.state === 'maintenance' || u.state === 'scheduled',
    );
    const state: HealthState =
      c.state === 'unhealthy' || disrupted
        ? 'unhealthy'
        : c.state === 'degraded' || observing
          ? 'degraded'
          : maintenance
            ? 'maintenance'
            : c.state;
    return { ...c, state };
  });
}
