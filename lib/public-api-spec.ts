/** Public bearer-key API only. Session-only and provider callback routes are separate. */
export const PUBLIC_API_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Call Vani API',
    version: '1.0.0',
    description:
      'Lead capture and wallet reads. No public call-creation endpoint. Contract reviewed 8 September 2026.',
  },
  servers: [
    { url: '/api/v1', description: 'Same deployment as this documentation' },
  ],
  security: [{ bearerAuth: [] }],
  paths: {
    '/leads': {
      get: {
        operationId: 'listLeads',
        summary: 'Newest 100 workspace leads',
        description:
          'Requires leads:read. No pagination or filters. Response fields are snake_case.',
        responses: {
          '200': {
            description: 'Lead list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/LeadListItem' },
                    },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        operationId: 'createLead',
        summary: 'Capture a lead',
        description:
          'Requires leads:write. Matching source and externalLeadId deduplicates the lead row, not webhook delivery. Duplicate requests still return 201. Configure the source first.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LeadInput' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created or existing lead',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { $ref: '#/components/schemas/LeadCreated' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid JSON, fields, source or ingestion failure',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/credits': {
      get: {
        operationId: 'getCredits',
        summary: 'Read wallet balance',
        description:
          'Requires credits:read. Credits are not currency or a universal duration unit.',
        responses: {
          '200': {
            description: 'Workspace wallet',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      required: ['balance', 'low_balance_threshold'],
                      properties: {
                        balance: { type: 'integer' },
                        low_balance_threshold: { type: 'integer' },
                        updated_at: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description:
          'Server-side vaani_live_ key. Scope is assigned when the key is created; this is not OAuth.',
      },
    },
    responses: {
      Unauthorized: {
        description: 'Missing, invalid, revoked or insufficient-scope API key',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
    },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'string' } } },
      LeadInput: {
        type: 'object',
        required: ['sourceType', 'name', 'phone'],
        properties: {
          sourceType: {
            type: 'string',
            enum: ['meta_ads', 'google_ads', 'website_form', 'manual'],
          },
          name: { type: 'string', minLength: 2 },
          phone: {
            type: 'string',
            minLength: 8,
            description:
              'Send international format; API currently performs length validation only.',
          },
          externalLeadId: { type: 'string' },
          email: { type: 'string' },
          campaignName: { type: 'string' },
          productInterest: { type: 'string' },
          notes: { type: 'string' },
          estimatedValue: { type: 'number', minimum: 0 },
        },
      },
      LeadListItem: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: ['string', 'null'] },
          status: { type: 'string' },
          score: { type: 'number' },
          intent: { type: 'string' },
          ai_summary: { type: ['string', 'null'] },
          captured_at: { type: 'string' },
          source: { type: 'string', description: 'Source type, e.g. manual' },
        },
      },
      LeadCreated: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          phone: { type: 'string' },
          source: {
            type: 'string',
            description: 'Source display name, not source type',
          },
          score: { type: 'number' },
          intent: { type: 'string' },
          status: { type: 'string' },
          summary: { type: 'string' },
          capturedAt: { type: 'string' },
          callJobId: { type: ['string', 'null'] },
          opportunityId: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;
