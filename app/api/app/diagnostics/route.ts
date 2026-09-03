import { NextResponse } from 'next/server';

import { getRawDb } from '@/db/index';
import { requireCustomer } from '@/lib/api-session';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import {
  evaluateReadiness,
  scoreQuality,
  supportCode,
  type QualityVerdict,
} from '@/lib/call-quality';

export const dynamic = 'force-dynamic';

/** The signed-in agent's saved devices, policy and recent test runs. */
export async function GET(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const db = getRawDb();
  const organizationId = auth.session.organizationId;

  const [preferences, runs, settings, agent] = await Promise.all([
    db
      .prepare(`SELECT input_device_label, output_device_label, input_device_id,
          output_device_id, ringtone_volume, updated_at
        FROM agent_device_preferences WHERE organization_id = ? AND user_id = ? LIMIT 1`)
      .bind(organizationId, auth.session.userId)
      .first(),
    db
      .prepare(`SELECT id, support_code, readiness, quality_score, quality_band,
          rtt_ms, jitter_ms, loss_percent, mic_level, input_device_label,
          output_device_label, browser, warnings_json, created_at
        FROM device_test_runs
        WHERE organization_id = ? AND user_id = ?
        ORDER BY created_at DESC LIMIT 10`)
      .bind(organizationId, auth.session.userId)
      .all(),
    db
      .prepare(`SELECT coalesce(require_device_test, 0) AS require_device_test,
          coalesce(device_test_valid_hours, 12) AS device_test_valid_hours
        FROM organization_settings WHERE organization_id = ? LIMIT 1`)
      .bind(organizationId)
      .first<{ require_device_test: number; device_test_valid_hours: number }>(),
    db
      .prepare(
        `SELECT id, availability FROM support_agents WHERE organization_id = ? AND user_id = ? LIMIT 1`,
      )
      .bind(organizationId, auth.session.userId)
      .first<{ id: string; availability: string }>(),
  ]);

  const validHours = Number(settings?.device_test_valid_hours ?? 12);
  const latest = (runs.results ?? [])[0] as
    | { readiness: string; created_at: string }
    | undefined;
  const passedRecently = Boolean(
    latest &&
      latest.readiness !== 'blocked' &&
      Date.now() - Date.parse(`${latest.created_at.replace(' ', 'T')}Z`) <
        validHours * 3600_000,
  );

  return NextResponse.json({
    preferences: preferences ?? null,
    runs: runs.results ?? [],
    policy: {
      requireDeviceTest: Boolean(settings?.require_device_test),
      validHours,
    },
    // What the Agent Desk needs to decide whether "go online" is allowed.
    gate: {
      onBench: Boolean(agent),
      availability: agent?.availability ?? null,
      passedRecently,
      blocked: Boolean(settings?.require_device_test) && !passedRecently,
    },
  });
}

/**
 * Records a completed device test (§5, §8). The browser measures; this scores,
 * decides readiness and issues a support code the agent can quote.
 */
export async function POST(request: Request) {
  const auth = await requireCustomer(request);
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    action?: string;
    rtts?: unknown;
    lossRatio?: unknown;
    micLevel?: unknown;
    microphonePermission?: string;
    hasInputDevice?: boolean;
    inputDeviceLabel?: string;
    outputDeviceLabel?: string;
    inputDeviceId?: string;
    outputDeviceId?: string;
    ringtoneVolume?: unknown;
    browser?: string;
    platform?: string;
  };
  const db = getRawDb();
  const organizationId = auth.session.organizationId!;
  const text = (value: unknown, max = 160) =>
    typeof value === 'string' ? value.trim().slice(0, max) : '';

  if (body.action === 'save_devices') {
    await db
      .prepare(`INSERT INTO agent_device_preferences
        (id, organization_id, user_id, input_device_label, output_device_label,
         input_device_id, output_device_id, ringtone_volume)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(organization_id, user_id) DO UPDATE SET
          input_device_label = excluded.input_device_label,
          output_device_label = excluded.output_device_label,
          input_device_id = excluded.input_device_id,
          output_device_id = excluded.output_device_id,
          ringtone_volume = excluded.ringtone_volume,
          updated_at = CURRENT_TIMESTAMP`)
      .bind(
        `devpref_${crypto.randomUUID()}`,
        organizationId,
        auth.session.userId,
        text(body.inputDeviceLabel),
        text(body.outputDeviceLabel),
        text(body.inputDeviceId, 200),
        text(body.outputDeviceId, 200),
        Math.min(
          100,
          Math.max(0, Math.round(Number(body.ringtoneVolume ?? 70)) || 70),
        ),
      )
      .run();
    return NextResponse.json({ ok: true });
  }

  if (body.action !== 'record_test')
    return NextResponse.json(
      { error: 'Unsupported diagnostics action.' },
      { status: 400 },
    );

  const rtts = Array.isArray(body.rtts)
    ? body.rtts
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0)
        .slice(0, 100)
    : [];
  const permission = [
    'granted',
    'denied',
    'prompt',
    'unsupported',
  ].includes(String(body.microphonePermission))
    ? (body.microphonePermission as
        | 'granted'
        | 'denied'
        | 'prompt'
        | 'unsupported')
    : 'prompt';
  const micLevel =
    typeof body.micLevel === 'number' && Number.isFinite(body.micLevel)
      ? Math.min(1, Math.max(0, body.micLevel))
      : null;

  const quality: QualityVerdict = scoreQuality({
    rtts,
    lossRatio: Number(body.lossRatio ?? 0),
    micLevel,
  });
  const readiness = evaluateReadiness({
    microphonePermission: permission,
    hasInputDevice: Boolean(body.hasInputDevice),
    micLevel,
    quality: rtts.length ? quality : null,
  });

  const id = `devtest_${crypto.randomUUID()}`;
  const code = supportCode(id);
  await db
    .prepare(`INSERT INTO device_test_runs
      (id, organization_id, user_id, support_code, readiness, quality_score,
       quality_band, rtt_ms, jitter_ms, loss_percent, mic_level,
       microphone_permission, input_device_label, output_device_label,
       browser, platform, warnings_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      organizationId,
      auth.session.userId,
      code,
      readiness.state,
      quality.score,
      quality.band,
      quality.rttMs,
      quality.jitterMs,
      quality.lossPercent,
      micLevel,
      permission,
      text(body.inputDeviceLabel),
      text(body.outputDeviceLabel),
      text(body.browser, 200),
      text(body.platform, 80),
      JSON.stringify([...quality.warnings, ...readiness.reasons.map((r) => ({ code: 'readiness', message: r }))]),
    )
    .run();

  return NextResponse.json({
    id,
    supportCode: code,
    quality,
    readiness,
  });
}

/** Workspace device policy (§19). */
export async function PATCH(request: Request) {
  const auth = await requireCustomerPermission(request, 'workspace.manage');
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    requireDeviceTest?: boolean;
    validHours?: unknown;
  };
  const hours = Math.min(
    168,
    Math.max(1, Math.round(Number(body.validHours ?? 12)) || 12),
  );
  await getRawDb()
    .prepare(`UPDATE organization_settings
      SET require_device_test = ?, device_test_valid_hours = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE organization_id = ?`)
    .bind(
      body.requireDeviceTest ? 1 : 0,
      hours,
      auth.session.organizationId,
    )
    .run();
  return NextResponse.json({
    requireDeviceTest: Boolean(body.requireDeviceTest),
    validHours: hours,
  });
}
