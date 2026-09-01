import { getRawDb } from '@/db/index';
import { decryptSecret } from '@/lib/security';

type SecretBundle = { apiKey?: string; webhookSecret?: string };
type IntegrationRow = {
  public_config_json: string;
  encrypted_secret: string | null;
};

type CommerceDeliveryResult = {
  status: string;
  providerReference: string;
  payload: unknown;
};

export async function createRazorpayPaymentLink(input: {
  organizationId: string;
  referenceId: string;
  amount: number;
  currency: string;
  description: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
}) {
  const credentials = await getRazorpayCredentials(input.organizationId);
  if (!credentials.keyId || !credentials.keySecret) {
    return {
      provider: 'razorpay_sandbox',
      externalId: null,
      shortUrl: `https://pay.local.vaani.test/${encodeURIComponent(input.referenceId)}`,
      payload: { mode: 'local_sandbox', reason: 'Razorpay test credentials are not connected.' },
    };
  }
  const response = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${credentials.keyId}:${credentials.keySecret}`)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      amount: input.amount,
      currency: input.currency,
      accept_partial: false,
      reference_id: input.referenceId,
      description: input.description,
      customer: {
        name: input.customerName,
        ...(input.customerPhone ? { contact: input.customerPhone } : {}),
        ...(input.customerEmail ? { email: input.customerEmail } : {}),
      },
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: { vaani_organization_id: input.organizationId },
    }),
  });
  const payload = (await response.json()) as {
    id?: string;
    short_url?: string;
    status?: string;
    error?: { description?: string };
  };
  if (!response.ok || !payload.id || !payload.short_url) {
    throw new Error(payload.error?.description ?? 'Razorpay could not create the payment link.');
  }
  return {
    provider: 'razorpay',
    externalId: payload.id,
    shortUrl: payload.short_url,
    payload,
  };
}

export async function sendEmailPaymentLink(input: {
  organizationId: string;
  destination: string;
  customerName: string;
  amount: number;
  shortUrl: string;
}): Promise<CommerceDeliveryResult> {
  const credentials = await emailCredentials(input.organizationId);
  if (!credentials.apiKey || !credentials.from) {
    return {
      status: 'sandbox_delivered',
      providerReference: `sandbox_email_${crypto.randomUUID()}`,
      payload: { mode: 'local_sandbox', reason: 'Transactional email credentials are not connected.' },
    };
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${credentials.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: credentials.from,
      to: [input.destination],
      subject: `Your secure payment link · ₹${(input.amount / 100).toLocaleString('en-IN')}`,
      html: `<p>Hello ${escapeHtml(input.customerName)},</p><p>Your secure payment link is ready.</p><p><a href="${escapeHtml(input.shortUrl)}">Pay ₹${(input.amount / 100).toLocaleString('en-IN')}</a></p>`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json() as { id?: string; message?: string };
  if (!response.ok || !payload.id) throw new Error(payload.message || 'Email could not send the payment link.');
  return { status: 'sent', providerReference: payload.id, payload };
}

export async function sendWhatsAppPaymentLink(input: {
  organizationId: string;
  destination: string;
  customerName: string;
  amount: number;
  shortUrl: string;
}): Promise<CommerceDeliveryResult> {
  const credentials = await whatsAppCredentials(input.organizationId);
  if (!credentials.accessToken || !credentials.phoneNumberId) {
    return {
      status: 'sandbox_delivered',
      providerReference: `sandbox_${crypto.randomUUID()}`,
      payload: { mode: 'local_sandbox', reason: 'WhatsApp Cloud API credentials are not connected.' },
    };
  }
  const response = await fetch(
    `https://graph.facebook.com/${credentials.graphVersion}/${credentials.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credentials.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: input.destination.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: credentials.templateName,
          language: { code: credentials.templateLanguage },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: input.customerName },
                { type: 'text', text: `₹${(input.amount / 100).toLocaleString('en-IN')}` },
                { type: 'text', text: input.shortUrl },
              ],
            },
          ],
        },
      }),
    },
  );
  const payload = (await response.json()) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string };
  };
  if (!response.ok || !payload.messages?.[0]?.id) {
    throw new Error(payload.error?.message ?? 'WhatsApp could not send the payment link.');
  }
  return {
    status: 'sent',
    providerReference: payload.messages[0].id,
    payload,
  };
}

export async function getRazorpayWebhookSecret(organizationId: string) {
  if (process.env.RAZORPAY_WEBHOOK_SECRET) return process.env.RAZORPAY_WEBHOOK_SECRET;
  const bundle = await integrationSecrets(organizationId, 'razorpay');
  return bundle.secrets.webhookSecret ?? null;
}

export async function getRazorpayCredentials(organizationId: string) {
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    return { keyId: process.env.RAZORPAY_KEY_ID, keySecret: process.env.RAZORPAY_KEY_SECRET };
  }
  const bundle = await integrationSecrets(organizationId, 'razorpay');
  return {
    keyId: bundle.publicConfig.accountId as string | undefined,
    keySecret: bundle.secrets.apiKey,
  };
}

async function whatsAppCredentials(organizationId: string) {
  if (process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
    return {
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      graphVersion: process.env.WHATSAPP_GRAPH_VERSION || 'v23.0',
      templateName: process.env.WHATSAPP_PAYMENT_TEMPLATE || 'vaani_payment_link',
      templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en',
    };
  }
  const bundle = await integrationSecrets(organizationId, 'whatsapp_cloud');
  return {
    accessToken: bundle.secrets.apiKey,
    phoneNumberId: bundle.publicConfig.accountId as string | undefined,
    graphVersion: (bundle.publicConfig.graphVersion as string | undefined) || 'v23.0',
    templateName: (bundle.publicConfig.templateName as string | undefined) || 'vaani_payment_link',
    templateLanguage: (bundle.publicConfig.templateLanguage as string | undefined) || 'en',
  };
}

async function emailCredentials(organizationId: string) {
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) return { apiKey: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };
  const bundle = await integrationSecrets(organizationId, 'email_resend');
  return { apiKey: bundle.secrets.apiKey, from: bundle.publicConfig.from as string | undefined };
}

async function integrationSecrets(organizationId: string, type: string) {
  const row = await getRawDb()
    .prepare(`SELECT public_config_json, encrypted_secret FROM integration_connections
      WHERE organization_id = ? AND type = ? LIMIT 1`)
    .bind(organizationId, type)
    .first<IntegrationRow>();
  if (!row) return { publicConfig: {} as Record<string, unknown>, secrets: {} as SecretBundle };
  const publicConfig = safeObject(row.public_config_json);
  if (!row.encrypted_secret) return { publicConfig, secrets: {} as SecretBundle };
  const decrypted = await decryptSecret(row.encrypted_secret);
  try {
    const parsed = JSON.parse(decrypted) as SecretBundle;
    return { publicConfig, secrets: parsed };
  } catch {
    return { publicConfig, secrets: { apiKey: decrypted } };
  }
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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);
}
