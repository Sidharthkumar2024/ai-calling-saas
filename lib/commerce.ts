import { getRawDb } from '@/db/index';
import { decryptSecret, sha256 } from '@/lib/security';
import { decodeProviderSecret } from '@/lib/provider-secret-policy';
import { readPlatformSecret } from '@/lib/platform-secrets';
import { replyWindow } from '@/lib/whatsapp-inbox';

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
      payload: {
        mode: 'local_sandbox',
        reason: 'Razorpay test credentials are not connected.',
      },
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
    throw new Error(
      payload.error?.description ??
        'Razorpay could not create the payment link.',
    );
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
      payload: {
        mode: 'local_sandbox',
        reason: 'Transactional email credentials are not connected.',
      },
    };
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${credentials.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: credentials.from,
      to: [input.destination],
      subject: `Your secure payment link · ₹${(input.amount / 100).toLocaleString('en-IN')}`,
      html: `<p>Hello ${escapeHtml(input.customerName)},</p><p>Your secure payment link is ready.</p><p><a href="${escapeHtml(input.shortUrl)}">Pay ₹${(input.amount / 100).toLocaleString('en-IN')}</a></p>`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json()) as { id?: string; message?: string };
  if (!response.ok || !payload.id)
    throw new Error(
      payload.message || 'Email could not send the payment link.',
    );
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
      payload: {
        mode: 'local_sandbox',
        reason: 'WhatsApp Cloud API credentials are not connected.',
      },
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
                {
                  type: 'text',
                  text: `₹${(input.amount / 100).toLocaleString('en-IN')}`,
                },
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
    throw new Error(
      payload.error?.message ?? 'WhatsApp could not send the payment link.',
    );
  }
  return {
    status: 'sent',
    providerReference: payload.messages[0].id,
    payload,
  };
}

/**
 * Sends a plain WhatsApp message.
 *
 * Separate from the payment-link sender because that one posts an approved
 * template. This posts free text, which WhatsApp only permits inside the
 * 24-hour window after the customer last messaged the business — outside it
 * the provider refuses, and the refusal is returned rather than swallowed, so
 * the row ends up `failed` with a reason instead of `sent`.
 */
export async function sendWhatsAppText(input: {
  organizationId: string;
  destination: string;
  body: string;
}): Promise<CommerceDeliveryResult> {
  const db = getRawDb();
  const normalizedPhone = `+${input.destination.replace(/\D/g, '')}`;
  const digitsPhone = normalizedPhone.slice(1);
  const suppressed = await db
    .prepare(
      `SELECT id FROM suppression_entries WHERE phone_hash IN (?, ?, ?) AND (organization_id = ? OR scope = 'global') AND (expires_at IS NULL OR datetime(expires_at) > datetime('now')) LIMIT 1`,
    )
    .bind(
      await sha256(input.destination),
      await sha256(normalizedPhone),
      await sha256(digitsPhone),
      input.organizationId,
    )
    .first();
  if (suppressed)
    throw new Error('This customer is on the do-not-contact list.');
  const inbound = await db
    .prepare(
      `SELECT MAX(created_at) AS last_at FROM whatsapp_messages WHERE organization_id = ? AND sender_phone IN (?, ?, ?) AND direction = 'inbound'`,
    )
    .bind(input.organizationId, input.destination, normalizedPhone, digitsPhone)
    .first<{ last_at: string | null }>();
  const window = replyWindow({ lastInboundAt: inbound?.last_at ?? null });
  if (!window.open) throw new Error(window.reason);
  const credentials = await whatsAppCredentials(input.organizationId);
  if (!credentials.accessToken || !credentials.phoneNumberId) {
    return {
      status: 'sandbox_delivered',
      providerReference: `sandbox_${crypto.randomUUID()}`,
      payload: {
        mode: 'local_sandbox',
        reason: 'WhatsApp Cloud API credentials are not connected.',
      },
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
        type: 'text',
        text: { preview_url: true, body: input.body.slice(0, 4096) },
      }),
    },
  );
  const payload = (await response.json()) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string };
  };
  if (!response.ok || !payload.messages?.[0]?.id)
    throw new Error(payload.error?.message ?? 'WhatsApp refused the message.');
  return {
    status: 'sent',
    providerReference: payload.messages[0].id,
    payload,
  };
}

/**
 * Sends an approved template.
 *
 * The counterpart to `sendWhatsAppText`, and the only thing that reaches a
 * customer whose 24-hour window has closed — so it deliberately does *not*
 * check that window. It does check the do-not-contact list, which the window
 * never had anything to do with: somebody who asked not to be contacted did
 * not thereby agree to receive templates.
 */
export async function sendWhatsAppTemplate(input: {
  organizationId: string;
  destination: string;
  name: string;
  language: string;
  params: string[];
}): Promise<CommerceDeliveryResult> {
  const db = getRawDb();
  const normalizedPhone = `+${input.destination.replace(/\D/g, '')}`;
  const digitsPhone = normalizedPhone.slice(1);
  const suppressed = await db
    .prepare(
      `SELECT id FROM suppression_entries WHERE phone_hash IN (?, ?, ?) AND (organization_id = ? OR scope = 'global') AND (expires_at IS NULL OR datetime(expires_at) > datetime('now')) LIMIT 1`,
    )
    .bind(
      await sha256(input.destination),
      await sha256(normalizedPhone),
      await sha256(digitsPhone),
      input.organizationId,
    )
    .first();
  if (suppressed)
    throw new Error('This customer is on the do-not-contact list.');

  const credentials = await whatsAppCredentials(input.organizationId);
  if (!credentials.accessToken || !credentials.phoneNumberId) {
    return {
      status: 'sandbox_delivered',
      providerReference: `sandbox_${crypto.randomUUID()}`,
      payload: {
        mode: 'local_sandbox',
        reason: 'WhatsApp Cloud API credentials are not connected.',
      },
    };
  }
  const components = input.params.length
    ? [
        {
          type: 'body',
          parameters: input.params.map((text) => ({ type: 'text', text })),
        },
      ]
    : [];
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
          name: input.name,
          language: { code: input.language },
          ...(components.length ? { components } : {}),
        },
      }),
    },
  );
  const payload = (await response.json()) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string };
  };
  if (!response.ok || !payload.messages?.[0]?.id)
    throw new Error(payload.error?.message ?? 'WhatsApp refused the template.');
  return { status: 'sent', providerReference: payload.messages[0].id, payload };
}

/**
 * What this workspace can do about templates, and why not when it cannot.
 *
 * Templates live on the WhatsApp Business Account rather than on the phone
 * number, so a workspace can be perfectly able to send messages and still be
 * unable to manage templates. That is a different sentence from "WhatsApp is
 * not connected", and the screen says whichever is true.
 */
export async function whatsAppTemplateAccess(organizationId: string) {
  const credentials = await whatsAppCredentials(organizationId);
  if (!credentials.accessToken)
    return {
      ok: false as const,
      reason:
        'Connect this workspace\u2019s WhatsApp number in Integrations & API first.',
    };
  if (!credentials.wabaId)
    return {
      ok: false as const,
      reason:
        'Add your WhatsApp Business Account ID to the WhatsApp connection. Templates live on the business account, not on the phone number.',
    };
  return {
    ok: true as const,
    accessToken: credentials.accessToken,
    wabaId: credentials.wabaId,
    graphVersion: credentials.graphVersion,
  };
}

/** Sends a draft to Meta for review. Returns Meta\u2019s id and first status. */
export async function submitWhatsAppTemplate(
  organizationId: string,
  payload: unknown,
): Promise<{ id: string; status: string }> {
  const access = await whatsAppTemplateAccess(organizationId);
  if (!access.ok) throw new Error(access.reason);
  const response = await fetch(
    `https://graph.facebook.com/${access.graphVersion}/${access.wabaId}/message_templates`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${access.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );
  const body = (await response.json()) as {
    id?: string;
    status?: string;
    error?: { error_user_msg?: string; message?: string };
  };
  if (!response.ok || !body.id)
    throw new Error(
      body.error?.error_user_msg ??
        body.error?.message ??
        'Meta refused the template.',
    );
  return { id: body.id, status: body.status ?? 'PENDING' };
}

/** Reads back what Meta currently thinks of this workspace\u2019s templates. */
export async function fetchWhatsAppTemplates(organizationId: string): Promise<
  Array<{
    id: string;
    name: string;
    language: string;
    status: string;
    category?: string;
    components?: unknown;
    rejected_reason?: string;
  }>
> {
  const access = await whatsAppTemplateAccess(organizationId);
  if (!access.ok) throw new Error(access.reason);
  const response = await fetch(
    `https://graph.facebook.com/${access.graphVersion}/${access.wabaId}/message_templates?limit=200`,
    { headers: { authorization: `Bearer ${access.accessToken}` } },
  );
  const body = (await response.json()) as {
    data?: Array<{
      id: string;
      name: string;
      language: string;
      status: string;
      category?: string;
      components?: unknown;
      rejected_reason?: string;
    }>;
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(
      body.error?.message ?? 'Meta did not return the templates.',
    );
  return body.data ?? [];
}

/**
 * Creates a Flow at Meta and uploads its definition.
 *
 * Two calls, because Meta separates the flow from what is in it: the first
 * makes an empty draft, the second attaches the Flow JSON. A draft that exists
 * with nothing in it is reported as the failure it is rather than left looking
 * like a flow somebody could publish.
 */
export async function createWhatsAppFlow(
  organizationId: string,
  input: { name: string; flowJson: Record<string, unknown> },
): Promise<{ id: string }> {
  const access = await whatsAppTemplateAccess(organizationId);
  if (!access.ok) throw new Error(access.reason);
  const created = await fetch(
    `https://graph.facebook.com/${access.graphVersion}/${access.wabaId}/flows`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${access.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: input.name,
        categories: ['LEAD_GENERATION'],
      }),
    },
  );
  const createdBody = (await created.json()) as {
    id?: string;
    error?: { error_user_msg?: string; message?: string };
  };
  if (!created.ok || !createdBody.id)
    throw new Error(
      createdBody.error?.error_user_msg ??
        createdBody.error?.message ??
        'Meta would not create the flow.',
    );

  const form = new FormData();
  form.append('name', 'flow.json');
  form.append('asset_type', 'FLOW_JSON');
  form.append(
    'file',
    new Blob([JSON.stringify(input.flowJson)], { type: 'application/json' }),
    'flow.json',
  );
  const uploaded = await fetch(
    `https://graph.facebook.com/${access.graphVersion}/${createdBody.id}/assets`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${access.accessToken}` },
      body: form,
    },
  );
  const uploadedBody = (await uploaded.json()) as {
    success?: boolean;
    validation_errors?: Array<{ message?: string }>;
    error?: { error_user_msg?: string; message?: string };
  };
  if (!uploaded.ok || uploadedBody.success === false) {
    // Meta's validation errors name the screen and the component. Rewritten,
    // they would be unsearchable; kept, they point at the thing to fix.
    const detail =
      uploadedBody.validation_errors
        ?.map((issue) => issue.message)
        .filter(Boolean)
        .join(' ') ||
      uploadedBody.error?.error_user_msg ||
      uploadedBody.error?.message ||
      'Meta would not accept the flow definition.';
    throw new Error(detail);
  }
  return { id: createdBody.id };
}

/** Publishes a flow. After this, its definition is fixed at Meta. */
export async function publishWhatsAppFlow(
  organizationId: string,
  providerId: string,
): Promise<void> {
  const access = await whatsAppTemplateAccess(organizationId);
  if (!access.ok) throw new Error(access.reason);
  const response = await fetch(
    `https://graph.facebook.com/${access.graphVersion}/${providerId}/publish`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${access.accessToken}` },
    },
  );
  const body = (await response.json()) as {
    success?: boolean;
    error?: { error_user_msg?: string; message?: string };
  };
  if (!response.ok || body.success === false)
    throw new Error(
      body.error?.error_user_msg ??
        body.error?.message ??
        'Meta would not publish the flow.',
    );
}

/** Reads back what Meta currently thinks of this workspace\u2019s flows. */
export async function fetchWhatsAppFlows(
  organizationId: string,
): Promise<Array<{ id: string; name: string; status: string }>> {
  const access = await whatsAppTemplateAccess(organizationId);
  if (!access.ok) throw new Error(access.reason);
  const response = await fetch(
    `https://graph.facebook.com/${access.graphVersion}/${access.wabaId}/flows?limit=200`,
    { headers: { authorization: `Bearer ${access.accessToken}` } },
  );
  const body = (await response.json()) as {
    data?: Array<{ id: string; name: string; status: string }>;
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(body.error?.message ?? 'Meta did not return the flows.');
  return body.data ?? [];
}

/**
 * Sends a published flow to one customer.
 *
 * Inside the 24-hour window, like any interactive message. The token is ours
 * and comes back with the answers, which is how a reply is matched to the
 * person who was asked rather than guessed from the number alone.
 */
export async function sendWhatsAppFlow(input: {
  organizationId: string;
  destination: string;
  flowProviderId: string;
  flowToken: string;
  screenId: string;
  ctaLabel: string;
  body: string;
}): Promise<CommerceDeliveryResult> {
  const db = getRawDb();
  const normalizedPhone = `+${input.destination.replace(/\D/g, '')}`;
  const digitsPhone = normalizedPhone.slice(1);
  const suppressed = await db
    .prepare(
      `SELECT id FROM suppression_entries WHERE phone_hash IN (?, ?, ?) AND (organization_id = ? OR scope = 'global') AND (expires_at IS NULL OR datetime(expires_at) > datetime('now')) LIMIT 1`,
    )
    .bind(
      await sha256(input.destination),
      await sha256(normalizedPhone),
      await sha256(digitsPhone),
      input.organizationId,
    )
    .first();
  if (suppressed)
    throw new Error('This customer is on the do-not-contact list.');

  const credentials = await whatsAppCredentials(input.organizationId);
  if (!credentials.accessToken || !credentials.phoneNumberId) {
    return {
      status: 'sandbox_delivered',
      providerReference: `sandbox_${crypto.randomUUID()}`,
      payload: {
        mode: 'local_sandbox',
        reason: 'WhatsApp Cloud API credentials are not connected.',
      },
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
        type: 'interactive',
        interactive: {
          type: 'flow',
          body: { text: input.body.slice(0, 1024) },
          action: {
            name: 'flow',
            parameters: {
              flow_message_version: '3',
              flow_token: input.flowToken,
              flow_id: input.flowProviderId,
              flow_cta: input.ctaLabel.slice(0, 20),
              flow_action: 'navigate',
              flow_action_payload: { screen: input.screenId },
            },
          },
        },
      }),
    },
  );
  const payload = (await response.json()) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string };
  };
  if (!response.ok || !payload.messages?.[0]?.id)
    throw new Error(payload.error?.message ?? 'WhatsApp refused the flow.');
  return { status: 'sent', providerReference: payload.messages[0].id, payload };
}

/** Whether this workspace could send a WhatsApp message at all right now. */
export async function whatsAppConnected(organizationId: string) {
  const credentials = await whatsAppCredentials(organizationId);
  return Boolean(credentials.accessToken && credentials.phoneNumberId);
}

export async function getRazorpayWebhookSecret(organizationId: string) {
  if (process.env.RAZORPAY_WEBHOOK_SECRET)
    return process.env.RAZORPAY_WEBHOOK_SECRET;
  const bundle = await integrationSecrets(organizationId, 'razorpay');
  return bundle.secrets.webhookSecret ?? null;
}

/**
 * The tenant's own merchant credential wins.
 *
 * A platform-wide env key used to take precedence, which would have collected a
 * tenant's customer payments into the platform's own Razorpay account — exactly
 * the ledger mixing the architecture forbids. The env pair is now only a
 * development fallback for a workspace that has connected nothing.
 */
export async function getRazorpayCredentials(organizationId: string) {
  const bundle = await integrationSecrets(organizationId, 'razorpay');
  const keyId = bundle.publicConfig.accountId as string | undefined;
  const keySecret = bundle.secrets.apiKey;
  if (keyId && keySecret)
    return { keyId, keySecret, source: 'tenant' as const };
  if (
    process.env.RAZORPAY_KEY_ID &&
    process.env.RAZORPAY_KEY_SECRET &&
    process.env.RAZORPAY_DEFAULT_ORGANIZATION_ID === organizationId
  ) {
    return {
      keyId: process.env.RAZORPAY_KEY_ID,
      keySecret: process.env.RAZORPAY_KEY_SECRET,
      source: 'platform_fallback' as const,
    };
  }
  return { keyId, keySecret, source: 'unconfigured' as const };
}

/**
 * The tenant's own WhatsApp sender wins, for the same reason: a shared env
 * number would have sent every workspace's messages from one identity.
 */
async function whatsAppCredentials(organizationId: string) {
  const platform = await readPlatformSecret('whatsapp');
  if (platform.disabled)
    return {
      accessToken: undefined,
      phoneNumberId: undefined,
      wabaId: undefined,
      graphVersion: 'v23.0',
      templateName: '',
      templateLanguage: 'en',
    };
  const tenant = await integrationSecrets(organizationId, 'whatsapp_cloud');
  const tenantPhoneId = tenant.publicConfig.accountId as string | undefined;
  if (!tenant.secrets.apiKey || !tenantPhoneId) {
    if (
      process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_DEFAULT_ORGANIZATION_ID === organizationId
    ) {
      return {
        accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
        graphVersion: process.env.WHATSAPP_GRAPH_VERSION || 'v23.0',
        templateName:
          process.env.WHATSAPP_PAYMENT_TEMPLATE || 'vaani_payment_link',
        templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en',
      };
    }
  }
  const bundle = tenant;
  return {
    accessToken: bundle.secrets.apiKey,
    phoneNumberId: bundle.publicConfig.accountId as string | undefined,
    // Templates live on the WhatsApp Business Account, not on the phone
    // number. A workspace can send without it and cannot manage templates
    // without it, so its absence is reported rather than assumed.
    wabaId: bundle.publicConfig.wabaId as string | undefined,
    graphVersion:
      (bundle.publicConfig.graphVersion as string | undefined) || 'v23.0',
    templateName:
      (bundle.publicConfig.templateName as string | undefined) ||
      'vaani_payment_link',
    templateLanguage:
      (bundle.publicConfig.templateLanguage as string | undefined) || 'en',
  };
}

async function emailCredentials(organizationId: string) {
  const platform = await readPlatformSecret('resend');
  if (platform.disabled) return { apiKey: undefined, from: undefined };
  // The marketplace stores this provider as `resend`; `email_resend` is the
  // legacy type kept so existing connections keep working. They used to
  // disagree, which meant a connected Resend key was never read.
  for (const type of ['resend', 'email_resend']) {
    const tenant = await integrationSecrets(organizationId, type);
    const from =
      (tenant.publicConfig.fromAddress as string | undefined) ||
      (tenant.publicConfig.from as string | undefined);
    if (tenant.secrets.apiKey && from)
      return { apiKey: tenant.secrets.apiKey, from };
  }
  if (
    platform.apiKey &&
    typeof platform.config.fromAddress === 'string' &&
    platform.config.fromAddress
  )
    return { apiKey: platform.apiKey, from: platform.config.fromAddress };
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
    return { apiKey: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };
  const bundle = await integrationSecrets(organizationId, 'email_resend');
  return {
    apiKey: bundle.secrets.apiKey,
    from: bundle.publicConfig.from as string | undefined,
  };
}

async function integrationSecrets(organizationId: string, type: string) {
  const row = await getRawDb()
    .prepare(`SELECT public_config_json, encrypted_secret FROM integration_connections
      WHERE organization_id = ? AND type = ? AND status != 'disabled'
      AND (type != 'whatsapp_cloud' OR status = 'connected') LIMIT 1`)
    .bind(organizationId, type)
    .first<IntegrationRow>();
  if (!row)
    return {
      publicConfig: {} as Record<string, unknown>,
      secrets: {} as SecretBundle,
    };
  const publicConfig = safeObject(row.public_config_json);
  if (!row.encrypted_secret)
    return { publicConfig, secrets: {} as SecretBundle };
  // A stored secret that will not decrypt — written under a key that has since
  // changed, or corrupted — used to throw out of here and 500 whatever asked.
  // The WhatsApp inbox reads this on every load, so one unreadable row took
  // the whole screen down rather than reading as "not connected", which is
  // what an unusable credential actually is.
  let decrypted: string;
  try {
    decrypted = await decryptSecret(row.encrypted_secret);
  } catch {
    return { publicConfig, secrets: {} as SecretBundle };
  }
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
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ] || character,
  );
}

/**
 * Generic transactional email. Team invitations were never delivered — the API
 * returned `delivery: 'email_pending'` in production and nothing ever sent one.
 */
export async function sendTransactionalEmail(input: {
  organizationId: string;
  to: string;
  subject: string;
  html: string;
}): Promise<CommerceDeliveryResult> {
  const credentials = await emailCredentials(input.organizationId);
  if (!credentials.apiKey || !credentials.from) {
    return {
      status: 'sandbox_delivered',
      providerReference: `sandbox_email_${crypto.randomUUID()}`,
      payload: {
        mode: 'local_sandbox',
        reason:
          'No transactional email provider is connected, so nothing was sent.',
      },
    };
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${credentials.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: credentials.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json()) as { id?: string; message?: string };
  if (!response.ok || !payload.id)
    throw new Error(payload.message || 'The email provider rejected the send.');
  return { status: 'sent', providerReference: payload.id, payload };
}

/**
 * Which workspace a WhatsApp message belongs to, from the number it arrived on.
 *
 * The webhook must never take a tenant id from the payload — that is a claim
 * by whoever sent the request. The phone number id is issued by Meta and is
 * bound to one workspace's own connection, so it is the only trustworthy
 * routing key in the delivery.
 */
export async function whatsAppInboundCredentials(phoneNumberId: string) {
  if (!/^\d{5,30}$/.test(phoneNumberId)) return null;
  const rows = await getRawDb()
    .prepare(`SELECT organization_id, encrypted_secret, public_config_json
      FROM integration_connections
      WHERE type = 'whatsapp_cloud' AND status = 'connected'
      AND json_valid(public_config_json)
      AND json_extract(public_config_json, '$.accountId') = ? LIMIT 2`)
    .bind(phoneNumberId)
    .all<{
      organization_id: string;
      encrypted_secret: string | null;
      public_config_json: string;
    }>();
  // An ambiguous asset claim is never routed to whichever tenant happens to be first.
  if ((rows.results ?? []).length > 1) return null;
  for (const row of rows.results ?? []) {
    let accountId: unknown;
    try {
      accountId = (
        JSON.parse(row.public_config_json || '{}') as {
          accountId?: unknown;
        }
      ).accountId;
    } catch {
      continue;
    }
    if (accountId !== phoneNumberId || !row.encrypted_secret) continue;
    const accessToken = decodeProviderSecret(
      await decryptSecret(row.encrypted_secret),
    ).apiKey;
    if (!accessToken) return null;
    return {
      organizationId: row.organization_id,
      accessToken,
      graphVersion: process.env.WHATSAPP_GRAPH_VERSION || 'v23.0',
    };
  }
  // A single-tenant deployment may configure the number in the environment
  // instead. It still has to match the number the message came in on.
  if (
    process.env.WHATSAPP_PHONE_NUMBER_ID === phoneNumberId &&
    process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.WHATSAPP_DEFAULT_ORGANIZATION_ID
  )
    return {
      organizationId: process.env.WHATSAPP_DEFAULT_ORGANIZATION_ID,
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
      graphVersion: process.env.WHATSAPP_GRAPH_VERSION || 'v23.0',
    };
  return null;
}
