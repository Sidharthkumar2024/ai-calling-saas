/** Customer-owned carrier numbers; Call Vani does not sell or approve numbers. */
export const NUMBER_PROVIDERS = [
  { id: 'twilio', label: 'Twilio', integration: 'telephony_twilio' },
  { id: 'plivo', label: 'Plivo', integration: 'telephony_plivo' },
  { id: 'exotel', label: 'Exotel', integration: 'telephony_exotel' },
  { id: 'vobiz', label: 'Vobiz', integration: 'telephony_vobiz' },
  { id: 'telnyx', label: 'Telnyx', integration: 'telephony_telnyx' },
  { id: 'vonage', label: 'Vonage', integration: 'telephony_vonage' },
  { id: 'sip', label: 'SIP / BYOC', integration: 'telephony_byoc' },
] as const;

export function numberConnectionLabel(status: string) {
  if (
    [
      'kyc_required',
      'kyc_review',
      'kyc_rejected',
      'pending_verification',
      'ownership_verification',
      'provider_review',
    ].includes(status)
  )
    return 'Provider setup required';
  return (
    (
      {
        active: 'Active route',
        pending_connection: 'Provider setup required',
        routing_required: 'Ownership verified · routing required',
        paused: 'Paused',
        released: 'Disconnected',
      } as Record<string, string>
    )[status] ?? status.replaceAll('_', ' ')
  );
}

export function numberOwnershipProbe(
  provider: string,
  account: string,
  phone: string,
) {
  if (
    !/^[A-Za-z0-9_-]{5,100}$/.test(account) ||
    !/^\+[1-9]\d{7,14}$/.test(phone)
  )
    return null;
  if (provider === 'twilio')
    return `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phone)}`;
  if (provider === 'plivo')
    return `https://api.plivo.com/v1/Account/${encodeURIComponent(account)}/Number/${phone.slice(1)}/`;
  return null;
}

export function ownsProviderNumber(
  provider: string,
  payload: unknown,
  phone: string,
) {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  const normalize = (v: unknown) =>
    typeof v === 'string' ? v.replace(/\D/g, '') : '';
  if (provider === 'twilio')
    return (
      Array.isArray(p.incoming_phone_numbers) &&
      p.incoming_phone_numbers.some((item: unknown) => {
        if (!item || typeof item !== 'object') return false;
        const n = item as Record<string, unknown>;
        const capabilities = n.capabilities as
          | Record<string, unknown>
          | undefined;
        return (
          normalize(n.phone_number) === normalize(phone) &&
          typeof n.sid === 'string' &&
          n.sid.length > 0 &&
          capabilities?.voice === true
        );
      })
    );
  if (provider === 'plivo')
    return (
      normalize(p.number) === normalize(phone) &&
      typeof p.resource_uri === 'string' &&
      p.voice_enabled === true
    );
  return false;
}
