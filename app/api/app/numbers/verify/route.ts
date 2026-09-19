import { NextResponse } from 'next/server';
import { getRawDb } from '@/db/index';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { decryptSecret } from '@/lib/security';
import { recordAudit } from '@/lib/demo-seed';
import {
  NUMBER_PROVIDERS,
  numberOwnershipProbe,
  ownsProviderNumber,
} from '@/lib/number-connection';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'telephony.manage');
  if (auth.response) return auth.response;
  const { numberId } = (await request.json()) as { numberId?: string };
  if (!numberId)
    return NextResponse.json({ error: 'Choose a number.' }, { status: 400 });
  const db = getRawDb();
  const row = await db
    .prepare(
      'SELECT phone_number, provider_code, status FROM phone_numbers WHERE id = ? AND organization_id = ?',
    )
    .bind(numberId, auth.session.organizationId)
    .first<{ phone_number: string; provider_code: string; status: string }>();
  if (!row)
    return NextResponse.json(
      { error: 'Number not found in this customer account.' },
      { status: 404 },
    );
  const provider = NUMBER_PROVIDERS.find((p) => p.id === row.provider_code);
  const connection = provider
    ? await db
        .prepare(
          'SELECT public_config_json, encrypted_secret FROM integration_connections WHERE organization_id = ? AND type = ?',
        )
        .bind(auth.session.organizationId, provider.integration)
        .first<{ public_config_json: string; encrypted_secret: string }>()
    : null;
  if (!connection?.encrypted_secret)
    return NextResponse.json(
      {
        error:
          'Connect this carrier in Integrations before checking ownership.',
      },
      { status: 409 },
    );
  if (!['twilio', 'plivo', 'vobiz'].includes(row.provider_code))
    return NextResponse.json(
      {
        error:
          'Automatic ownership lookup is not available for this carrier yet. Configure your carrier account and SIP/callback routing in Integrations. The connection remains unverified until provider evidence is available.',
      },
      { status: 409 },
    );
  let phase = 'credentials';
  try {
    const config = JSON.parse(connection.public_config_json || '{}');
    const secret = JSON.parse(await decryptSecret(connection.encrypted_secret));
    const url = numberOwnershipProbe(
      row.provider_code,
      String(config.accountId || ''),
      row.phone_number,
    );
    if (!url || !secret.apiKey)
      return NextResponse.json(
        {
          error:
            'This carrier needs a valid account ID and auth token in Integrations.',
        },
        { status: 409 },
      );
    phase = 'provider_request';
    const response = await fetch(url, {
      headers:
        row.provider_code === 'vobiz'
          ? {
              'X-Auth-ID': String(config.accountId),
              'X-Auth-Token': String(secret.apiKey),
            }
          : {
              authorization: `Basic ${btoa(`${config.accountId}:${secret.apiKey}`)}`,
            },
      signal: AbortSignal.timeout(10000),
      // workerd supports manual/follow, not the browser-only error mode.
      // Reject 3xx below rather than forwarding carrier secrets to a redirect.
      redirect: 'manual',
    });
    if (!response.ok)
      return NextResponse.json(
        {
          error: `Carrier ownership check failed (HTTP ${response.status}). Check your provider credentials and number.`,
        },
        { status: 502 },
      );
    phase = 'provider_response';
    if (
      !ownsProviderNumber(
        row.provider_code,
        await response.json(),
        row.phone_number,
      )
    )
      return NextResponse.json(
        {
          error:
            'The carrier did not confirm a voice-enabled number in your account.',
        },
        { status: 409 },
      );
    // Ownership alone does not prove that callbacks/media routing work.
    phase = 'save_verification';
    await db
      .prepare(
        `UPDATE phone_numbers SET kyc_status = 'provider_managed', status = CASE WHEN status = 'active' THEN status ELSE 'routing_required' END, onboarding_status = CASE WHEN status = 'active' THEN onboarding_status ELSE 'routing_required' END WHERE id = ? AND organization_id = ?`,
      )
      .bind(numberId, auth.session.organizationId)
      .run();
    // This authenticated read proves both the credential pair and ownership of
    // the exact voice-enabled number. Leaving the connection itself labelled
    // `stored_unverified` after that proof made the integration screen disagree
    // with the number screen and blocked readiness checks indefinitely.
    await db
      .prepare(`UPDATE integration_connections SET status = 'connected',
        last_checked_at = CURRENT_TIMESTAMP
        WHERE organization_id = ? AND type = ?`)
      .bind(auth.session.organizationId, provider!.integration)
      .run();
    await recordAudit(
      auth.session,
      'number.provider_ownership_verified',
      'phone_number',
      numberId,
      { provider: row.provider_code },
    );
    return NextResponse.json({
      ok: true,
      nextStep:
        'Provider ownership verified. Call routing still needs a supported carrier callback and a successful connection test; this check does not activate calls.',
    });
  } catch (error) {
    // Never log credentials, URLs, response bodies or raw exception messages.
    const reason =
      error instanceof Error &&
      [
        'TimeoutError',
        'AbortError',
        'SyntaxError',
        'OperationError',
        'TypeError',
      ].includes(error.name)
        ? error.name
        : 'Error';
    console.error('number.ownership_check_failed', {
      provider: row.provider_code,
      phase,
      reason,
    });
    return NextResponse.json(
      {
        code: 'ownership_check_failed',
        phase,
        error:
          'Could not complete the provider ownership check. Try again or update the carrier credentials.',
      },
      { status: 502 },
    );
  }
}
