/**
 * Integration marketplace catalog (blueprint §13).
 *
 * One source of truth for both the API's validation and the portal grid. The
 * supported types used to be a bare Set on the server and a hand-maintained
 * list of <option> elements in the UI, so the two could disagree about what was
 * connectable — and neither carried a category, required fields, or whether a
 * live credential test even exists.
 *
 * `verifiable: false` means there is no cheap, documented read-only endpoint we
 * can call to prove a credential works. Those connections are stored encrypted
 * and reported as unverified rather than being shown as connected.
 */

export type IntegrationCategory =
  | 'telephony'
  | 'llm'
  | 'tts'
  | 'stt'
  | 'messaging'
  | 'payments'
  | 'commerce'
  | 'crm'
  | 'tools';

export const INTEGRATION_CATEGORIES: Array<{
  id: IntegrationCategory;
  label: string;
}> = [
  { id: 'telephony', label: 'Telephony' },
  { id: 'llm', label: 'LLM' },
  { id: 'tts', label: 'TTS' },
  { id: 'stt', label: 'STT' },
  { id: 'messaging', label: 'Messaging' },
  { id: 'payments', label: 'Payments' },
  { id: 'commerce', label: 'Commerce' },
  { id: 'crm', label: 'CRM' },
  { id: 'tools', label: 'Tools' },
];

export type CredentialFieldKey =
  | 'apiKey'
  | 'accountId'
  | 'baseUrl'
  | 'webhookSecret'
  | 'model'
  | 'fromAddress';

export type CredentialField = {
  key: CredentialFieldKey;
  label: string;
  required: boolean;
  placeholder?: string;
  /** Rendered as a password field and never returned by the API. */
  secret?: boolean;
  hint?: string;
};

export type IntegrationDefinition = {
  id: string;
  label: string;
  category: IntegrationCategory;
  blurb: string;
  fields: CredentialField[];
  /** Whether a live read-only credential test is implemented. */
  verifiable: boolean;
  /** Short monogram for the grid tile. */
  monogram: string;
};

const KEY = (label = 'API key', placeholder?: string): CredentialField => ({
  key: 'apiKey',
  label,
  required: true,
  secret: true,
  ...(placeholder ? { placeholder } : {}),
});

export const INTEGRATION_CATALOG: IntegrationDefinition[] = [
  // ---- Telephony ----
  {
    id: 'telephony_twilio',
    label: 'Twilio',
    category: 'telephony',
    blurb: 'Global voice numbers, programmable calls and SIP.',
    monogram: 'Tw',
    verifiable: true,
    fields: [
      {
        key: 'accountId',
        label: 'Account SID',
        required: true,
        placeholder: 'AC…',
      },
      KEY('Auth token'),
    ],
  },
  {
    id: 'telephony_plivo',
    label: 'Plivo',
    category: 'telephony',
    blurb: 'Voice API and Indian DID numbers.',
    monogram: 'Pl',
    verifiable: true,
    fields: [
      { key: 'accountId', label: 'Auth ID', required: true, placeholder: 'MA…' },
      KEY('Auth token'),
    ],
  },
  {
    id: 'telephony_exotel',
    label: 'Exotel',
    category: 'telephony',
    blurb: 'Indian cloud telephony with local compliance.',
    monogram: 'Ex',
    verifiable: false,
    fields: [
      { key: 'accountId', label: 'Account SID', required: true },
      KEY('API token'),
      {
        key: 'baseUrl',
        label: 'API base URL',
        required: false,
        placeholder: 'https://api.exotel.com',
        hint: 'Region-specific; leave blank to store without a live test.',
      },
    ],
  },
  {
    id: 'telephony_vobiz',
    label: 'Vobiz',
    category: 'telephony',
    blurb: 'Indian voice provider.',
    monogram: 'Vo',
    verifiable: false,
    fields: [KEY(), { key: 'baseUrl', label: 'API base URL', required: false }],
  },
  {
    id: 'telephony_telnyx',
    label: 'Telnyx',
    category: 'telephony',
    blurb: 'Programmable voice and SIP trunking.',
    monogram: 'Tn',
    verifiable: false,
    fields: [KEY('API key')],
  },
  {
    id: 'telephony_vonage',
    label: 'Vonage',
    category: 'telephony',
    blurb: 'Voice API and numbers.',
    monogram: 'Vn',
    verifiable: false,
    fields: [
      { key: 'accountId', label: 'API key', required: true },
      KEY('API secret'),
    ],
  },
  {
    id: 'telephony_byoc',
    label: 'SIP / bring your own carrier',
    category: 'telephony',
    blurb: 'Connect an existing SIP trunk or enterprise PBX.',
    monogram: 'SIP',
    verifiable: false,
    fields: [
      {
        key: 'baseUrl',
        label: 'Gateway URI',
        required: true,
        placeholder: 'sip:gateway.example.com',
      },
      KEY('SIP password'),
    ],
  },

  // ---- LLM ----
  {
    id: 'anthropic_reasoning',
    label: 'Anthropic',
    category: 'llm',
    blurb: 'Claude models for conversation and post-call intelligence.',
    monogram: 'An',
    verifiable: true,
    fields: [KEY('API key', 'sk-ant-…')],
  },
  {
    id: 'openai_platform',
    label: 'OpenAI',
    category: 'llm',
    blurb: 'GPT models and the Realtime voice path.',
    monogram: 'AI',
    verifiable: true,
    fields: [KEY('API key', 'sk-…')],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    category: 'llm',
    blurb: 'One key for many hosted models.',
    monogram: 'OR',
    verifiable: true,
    fields: [KEY('API key', 'sk-or-…')],
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    category: 'llm',
    blurb: 'Search-grounded answers.',
    monogram: 'Px',
    verifiable: false,
    fields: [KEY('API key', 'pplx-…')],
  },
  {
    id: 'custom_llm',
    label: 'Custom LLM',
    category: 'llm',
    blurb: 'Any OpenAI-compatible endpoint you host or resell.',
    monogram: '{}',
    verifiable: true,
    fields: [
      {
        key: 'baseUrl',
        label: 'Base URL',
        required: true,
        placeholder: 'https://your-host/v1',
        hint: 'Must expose an OpenAI-compatible /models endpoint.',
      },
      {
        key: 'model',
        label: 'Model name',
        required: true,
        placeholder: 'my-org/my-model',
      },
      KEY('API key'),
    ],
  },

  // ---- TTS ----
  {
    id: 'elevenlabs_voice',
    label: 'ElevenLabs',
    category: 'tts',
    blurb: 'Human-sounding multilingual voices.',
    monogram: '11',
    verifiable: true,
    fields: [KEY(), { key: 'accountId', label: 'Default voice ID', required: false }],
  },
  {
    id: 'cartesia',
    label: 'Cartesia',
    category: 'tts',
    blurb: 'Low-latency streaming speech.',
    monogram: 'Ca',
    verifiable: false,
    fields: [KEY()],
  },
  {
    id: 'rime',
    label: 'Rime',
    category: 'tts',
    blurb: 'Conversational TTS voices.',
    monogram: 'Ri',
    verifiable: false,
    fields: [KEY()],
  },

  // ---- STT ----
  {
    id: 'deepgram',
    label: 'Deepgram',
    category: 'stt',
    blurb: 'Streaming speech recognition.',
    monogram: 'Dg',
    verifiable: true,
    fields: [KEY()],
  },
  {
    id: 'sarvam_voice',
    label: 'Sarvam',
    category: 'stt',
    blurb: 'Indian-language speech recognition and synthesis.',
    monogram: 'Sa',
    verifiable: false,
    fields: [KEY()],
  },

  // ---- Messaging ----
  {
    id: 'whatsapp_cloud',
    label: 'WhatsApp Cloud API',
    category: 'messaging',
    blurb: 'Send payment links and confirmations from your own number.',
    monogram: 'Wa',
    verifiable: false,
    fields: [
      { key: 'accountId', label: 'Phone number ID', required: true },
      KEY('Access token'),
    ],
  },
  {
    id: 'aisensy',
    label: 'AiSensy',
    category: 'messaging',
    blurb: 'WhatsApp campaigns through AiSensy.',
    monogram: 'Ai',
    verifiable: false,
    fields: [KEY()],
  },
  {
    id: 'resend',
    label: 'Resend',
    category: 'messaging',
    blurb: 'Transactional email for links, receipts and team invitations.',
    monogram: 'Re',
    verifiable: true,
    fields: [
      KEY('API key', 're_…'),
      {
        key: 'fromAddress',
        label: 'From address',
        required: true,
        placeholder: 'Vaani <no-reply@your-domain.com>',
        hint: 'Must be a domain verified in Resend.',
      },
    ],
  },

  // ---- Payments ----
  {
    id: 'razorpay',
    label: 'Razorpay',
    category: 'payments',
    blurb: 'Collect from your customers with your own merchant account.',
    monogram: 'Rz',
    verifiable: true,
    fields: [
      { key: 'accountId', label: 'Key ID', required: true, placeholder: 'rzp_…' },
      KEY('Key secret'),
    ],
  },
  {
    id: 'stripe',
    label: 'Stripe',
    category: 'payments',
    blurb: 'Card payments outside India.',
    monogram: 'St',
    verifiable: true,
    fields: [KEY('Secret key', 'sk_live_…')],
  },

  // ---- Commerce ----
  {
    id: 'shopify',
    label: 'Shopify',
    category: 'commerce',
    blurb: 'Orders and customers for order-status calls.',
    monogram: 'Sh',
    verifiable: true,
    fields: [
      {
        key: 'accountId',
        label: 'Store domain',
        required: true,
        placeholder: 'my-store.myshopify.com',
      },
      KEY('Admin API access token', 'shpat_…'),
    ],
  },

  // ---- CRM ----
  {
    id: 'hubspot',
    label: 'HubSpot',
    category: 'crm',
    blurb: 'Sync contacts, deals and activity.',
    monogram: 'Hs',
    verifiable: true,
    fields: [KEY('Private app token', 'pat-…')],
  },
  {
    id: 'salesforce',
    label: 'Salesforce',
    category: 'crm',
    blurb: 'Leads and opportunities.',
    monogram: 'Sf',
    verifiable: false,
    fields: [
      { key: 'baseUrl', label: 'Instance URL', required: true },
      KEY('Access token'),
    ],
  },
  {
    id: 'zoho',
    label: 'Zoho CRM',
    category: 'crm',
    blurb: 'Leads and contacts.',
    monogram: 'Zo',
    verifiable: false,
    fields: [
      { key: 'baseUrl', label: 'API domain', required: true },
      KEY('Access token'),
    ],
  },
  {
    id: 'pipedrive',
    label: 'Pipedrive',
    category: 'crm',
    blurb: 'Deals pipeline sync.',
    monogram: 'Pd',
    verifiable: false,
    fields: [KEY('API token')],
  },
  {
    id: 'crm',
    label: 'Generic CRM webhook',
    category: 'crm',
    blurb: 'Push leads to any authenticated endpoint.',
    monogram: 'CRM',
    verifiable: false,
    fields: [
      { key: 'baseUrl', label: 'Endpoint URL', required: true },
      KEY('Bearer token'),
    ],
  },

  // ---- Tools ----
  {
    id: 'calcom',
    label: 'Cal.com',
    category: 'tools',
    blurb: 'Real availability and booking.',
    monogram: 'Cal',
    verifiable: false,
    fields: [KEY()],
  },
  {
    id: 'google_sheets',
    label: 'Google Sheets',
    category: 'tools',
    blurb: 'Append leads to a sheet.',
    monogram: 'Gs',
    verifiable: false,
    fields: [KEY('Service account key')],
  },
  {
    id: 'zapier',
    label: 'Zapier',
    category: 'tools',
    blurb: 'Fan out events to thousands of apps.',
    monogram: 'Zp',
    verifiable: false,
    fields: [KEY('Webhook token')],
  },
  {
    id: 'make',
    label: 'Make',
    category: 'tools',
    blurb: 'Scenario automation.',
    monogram: 'Mk',
    verifiable: false,
    fields: [KEY('Webhook token')],
  },
  {
    id: 'n8n',
    label: 'n8n',
    category: 'tools',
    blurb: 'Self-hosted workflow automation.',
    monogram: 'n8',
    verifiable: false,
    fields: [
      { key: 'baseUrl', label: 'Webhook URL', required: true },
      KEY('Header token'),
    ],
  },
  {
    id: 'meta_ads',
    label: 'Meta Lead Ads',
    category: 'tools',
    blurb: 'Call new Facebook and Instagram leads instantly.',
    monogram: 'Me',
    verifiable: false,
    fields: [KEY('Access token')],
  },
  {
    id: 'google_ads',
    label: 'Google Lead Forms',
    category: 'tools',
    blurb: 'Call new Google lead-form submissions.',
    monogram: 'Gg',
    verifiable: false,
    fields: [KEY('Access token')],
  },
  {
    id: 'custom_http',
    label: 'Custom HTTP tool',
    category: 'tools',
    blurb: 'Give the agent any authenticated REST endpoint.',
    monogram: 'API',
    verifiable: false,
    fields: [
      { key: 'baseUrl', label: 'Base URL', required: true },
      KEY('Bearer token'),
      { key: 'webhookSecret', label: 'Signing secret', required: false, secret: true },
    ],
  },
  {
    id: 'willow_custom',
    label: 'Willow / custom calling API',
    category: 'telephony',
    blurb: 'Bring a calling API that is not in the catalog.',
    monogram: 'Wl',
    verifiable: false,
    fields: [
      { key: 'baseUrl', label: 'API base URL', required: true },
      KEY(),
    ],
  },
];

export const INTEGRATION_TYPES: ReadonlySet<string> = new Set(
  INTEGRATION_CATALOG.map((entry) => entry.id),
);

export function catalogEntry(type: string) {
  return INTEGRATION_CATALOG.find((entry) => entry.id === type) ?? null;
}
