import { getRawDb } from '@/db/index';
import { decryptSecret } from '@/lib/security';

type SmsSecretBundle = {
  apiKey?: string;
};

type SmsIntegrationRow = {
  public_config_json: string;
  encrypted_secret: string | null;
};

export type SmsSendResult = {
  status: 'sent' | 'sandbox_delivered' | 'rejected';
  providerReference: string;
  payload: unknown;
};

export async function sendSmsMessage(input: {
  organizationId: string;
  to: string;
  message: string;
}): Promise<SmsSendResult> {
  const credentials = await smsCredentials(input.organizationId);
  if (!credentials.baseUrl || !credentials.apiKey) {
    return {
      status: 'sandbox_delivered',
      providerReference: `sandbox_sms_${crypto.randomUUID()}`,
      payload: {
        mode: 'local_sandbox',
        reason:
          'No SMS gateway is connected. Configure SMS gateway under Integrations.',
      },
    };
  }

  const response = await fetch(credentials.baseUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${credentials.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      to: input.to,
      message: input.message,
      senderId: credentials.senderId || undefined,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { text: await response.text() };
  if (!response.ok) {
    return {
      status: 'rejected',
      providerReference: `sms_rejected_${crypto.randomUUID()}`,
      payload,
    };
  }
  const providerReference =
    typeof payload === 'object' &&
    payload &&
    'id' in payload &&
    typeof payload.id === 'string'
      ? payload.id
      : `sms_${crypto.randomUUID()}`;
  return { status: 'sent', providerReference, payload };
}

async function smsCredentials(organizationId: string) {
  const row = await getRawDb()
    .prepare(
      `SELECT public_config_json, encrypted_secret
       FROM integration_connections
       WHERE organization_id = ? AND type = 'sms_gateway' AND status != 'disabled'
       LIMIT 1`,
    )
    .bind(organizationId)
    .first<SmsIntegrationRow>();
  if (!row)
    return {
      baseUrl: '',
      senderId: '',
      apiKey: '',
    };

  const publicConfig = safeObject(row.public_config_json);
  const baseUrl =
    typeof publicConfig.baseUrl === 'string' ? publicConfig.baseUrl : '';
  const senderId =
    typeof publicConfig.senderId === 'string' ? publicConfig.senderId : '';
  if (!row.encrypted_secret) return { baseUrl, senderId, apiKey: '' };

  let secrets: SmsSecretBundle = {};
  try {
    const decrypted = await decryptSecret(row.encrypted_secret);
    const parsed = JSON.parse(decrypted) as SmsSecretBundle;
    secrets = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    secrets = {};
  }
  return {
    baseUrl,
    senderId,
    apiKey: secrets.apiKey ?? '',
  };
}

function safeObject(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
