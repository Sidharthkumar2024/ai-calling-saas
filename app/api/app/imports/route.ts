import { NextResponse } from 'next/server';

import { ensureSchema } from '@/db/bootstrap';
import { getRawDb } from '@/db/index';
import { requireCustomerPermission } from '@/lib/customer-rbac';
import { recordAudit } from '@/lib/demo-seed';
import { sha256 } from '@/lib/security';
import { SUPPORTED_LANGUAGE_CODES } from '@/lib/languages';
import {
  IMPORT_FIELDS,
  normalisePhone,
  parseSpreadsheet,
  suggestMapping,
  type ImportField,
} from '@/lib/spreadsheet';

export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Recent import jobs, with their outcome. */
export async function GET(request: Request) {
  const auth = await requireCustomerPermission(request, 'campaigns.manage');
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const jobId = (url.searchParams.get('job') ?? '').trim();
  const db = getRawDb();
  const organizationId = auth.session.organizationId;

  if (jobId) {
    const job = await db
      .prepare(
        `SELECT * FROM import_jobs WHERE id = ? AND organization_id = ? LIMIT 1`,
      )
      .bind(jobId, organizationId)
      .first();
    if (!job)
      return NextResponse.json({ error: 'Import not found.' }, { status: 404 });
    const status = url.searchParams.get('rows') ?? 'rejected';
    const rows = await db
      .prepare(`SELECT row_number, phone, name, language, status, reason
        FROM import_rows WHERE import_job_id = ? AND organization_id = ?
          AND (? = 'all' OR status = ?)
        ORDER BY row_number LIMIT 200`)
      .bind(jobId, organizationId, status, status)
      .all();
    return NextResponse.json({
      job,
      rows: rows.results ?? [],
      fields: IMPORT_FIELDS,
    });
  }

  const jobs = await db
    .prepare(`SELECT id, filename, format, status, total_rows, accepted_rows,
        rejected_rows, duplicate_rows, suppressed_rows, truncated, campaign_id,
        created_at, committed_at
      FROM import_jobs WHERE organization_id = ?
      ORDER BY created_at DESC LIMIT 25`)
    .bind(organizationId)
    .all();
  return NextResponse.json({ jobs: jobs.results ?? [], fields: IMPORT_FIELDS });
}

/**
 * Upload and preview (§10). Nothing is added to a campaign here: the customer
 * sees exactly which rows were accepted and why each other row was not, then
 * commits. Importing blind is how a contact list ends up dialling the wrong
 * people.
 */
export async function POST(request: Request) {
  const auth = await requireCustomerPermission(request, 'campaigns.manage');
  if (auth.response) return auth.response;
  await ensureSchema();
  const organizationId = auth.session.organizationId!;

  const form = await request.formData().catch(() => null);
  if (!form)
    return NextResponse.json(
      { error: 'Upload the file as multipart/form-data.' },
      { status: 400 },
    );
  const file = form.get('file');
  if (!(file instanceof File))
    return NextResponse.json({ error: 'A file is required.' }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES)
    return NextResponse.json(
      {
        error: `That file is ${Math.round(file.size / 1024 / 1024)} MB; the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Split it or remove unused columns.`,
      },
      { status: 413 },
    );
  const submittedCountry = form.get('countryCode');
  const countryCode =
    (typeof submittedCountry === 'string'
      ? submittedCountry.replace(/\D/g, '')
      : '') || '91';

  let table;
  try {
    table = await parseSpreadsheet(file.name, await file.arrayBuffer());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'The file could not be read.',
      },
      { status: 400 },
    );
  }
  if (!table.headers.length)
    return NextResponse.json(
      { error: 'The file has no header row.' },
      { status: 400 },
    );

  // Explicit mapping wins; otherwise guess from the headers.
  let mapping: Partial<Record<ImportField, number>> = {};
  const submitted = form.get('mapping');
  if (typeof submitted === 'string' && submitted.trim()) {
    try {
      const parsed = JSON.parse(submitted) as Record<string, unknown>;
      for (const field of IMPORT_FIELDS) {
        const value = Number(parsed[field.key]);
        if (
          Number.isInteger(value) &&
          value >= 0 &&
          value < table.headers.length
        )
          mapping[field.key] = value;
      }
    } catch {
      mapping = {};
    }
  }
  if (mapping.phone === undefined) mapping = suggestMapping(table.headers);
  if (mapping.phone === undefined)
    return NextResponse.json(
      {
        error:
          'No column looks like a phone number. Map one explicitly and upload again.',
        headers: table.headers,
        suggested: mapping,
      },
      { status: 422 },
    );

  const db = getRawDb();
  // Suppression is checked at import time so a customer never sees a row
  // accepted that the dialer will silently refuse later.
  const suppressed = await db
    .prepare(`SELECT phone_hash FROM suppression_entries
      WHERE (organization_id = ? OR scope = 'global')
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`)
    .bind(organizationId)
    .all<{ phone_hash: string }>();
  const suppressedHashes = new Set(
    (suppressed.results ?? []).map((row) => row.phone_hash),
  );

  const cell = (row: string[], field: ImportField) => {
    const index = mapping[field];
    return index === undefined ? '' : (row[index] ?? '').trim();
  };

  const jobId = `import_${crypto.randomUUID()}`;
  const seen = new Set<string>();
  const prepared: Array<{
    rowNumber: number;
    phone: string | null;
    name: string;
    language: string | null;
    timezone: string;
    company: string;
    notes: string;
    status: string;
    reason: string | null;
    raw: string[];
  }> = [];
  let accepted = 0;
  let rejected = 0;
  let duplicates = 0;
  let suppressedCount = 0;

  for (const [index, row] of table.rows.entries()) {
    const rowNumber = index + 2; // 1-based, plus the header row
    const rawPhone = cell(row, 'phone');
    const { phone, reason } = normalisePhone(rawPhone, countryCode);
    const language = cell(row, 'language');
    const base = {
      rowNumber,
      phone,
      name: cell(row, 'name').slice(0, 120),
      language: SUPPORTED_LANGUAGE_CODES.has(language) ? language : null,
      timezone: cell(row, 'timezone').slice(0, 60),
      company: cell(row, 'company').slice(0, 120),
      notes: cell(row, 'notes').slice(0, 400),
      raw: row.slice(0, 20),
    };
    if (!phone) {
      rejected += 1;
      prepared.push({
        ...base,
        status: 'rejected',
        reason: reason ?? 'invalid_phone',
      });
      continue;
    }
    if (seen.has(phone)) {
      duplicates += 1;
      prepared.push({
        ...base,
        status: 'duplicate',
        reason: 'duplicate_in_file',
      });
      continue;
    }
    seen.add(phone);
    if (suppressedHashes.has(await sha256(phone))) {
      suppressedCount += 1;
      prepared.push({
        ...base,
        status: 'suppressed',
        reason: 'on_suppression_list',
      });
      continue;
    }
    accepted += 1;
    prepared.push({ ...base, status: 'accepted', reason: null });
  }

  await db
    .prepare(`INSERT INTO import_jobs
      (id, organization_id, created_by_user_id, filename, format, status,
       headers_json, mapping_json, total_rows, accepted_rows, rejected_rows,
       duplicate_rows, suppressed_rows, truncated, default_country_code)
      VALUES (?, ?, ?, ?, ?, 'previewed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      jobId,
      organizationId,
      auth.session.userId,
      file.name.slice(0, 200),
      table.format,
      JSON.stringify(table.headers),
      JSON.stringify(mapping),
      table.rows.length,
      accepted,
      rejected,
      duplicates,
      suppressedCount,
      table.truncated ? 1 : 0,
      countryCode,
    )
    .run();

  // Batched so a large file is not thousands of round trips.
  for (let start = 0; start < prepared.length; start += 100) {
    await db.batch(
      prepared.slice(start, start + 100).map((row) =>
        db
          .prepare(`INSERT INTO import_rows
            (id, organization_id, import_job_id, row_number, phone, name,
             language, timezone, company, notes, status, reason, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            `irow_${crypto.randomUUID()}`,
            organizationId,
            jobId,
            row.rowNumber,
            row.phone,
            row.name || null,
            row.language,
            row.timezone || null,
            row.company || null,
            row.notes || null,
            row.status,
            row.reason,
            JSON.stringify(row.raw),
          ),
      ),
    );
  }

  await recordAudit(auth.session, 'import.previewed', 'import', jobId, {
    filename: file.name,
    accepted,
    rejected,
  });
  return NextResponse.json({
    jobId,
    format: table.format,
    headers: table.headers,
    mapping,
    totals: {
      rows: table.rows.length,
      accepted,
      rejected,
      duplicates,
      suppressed: suppressedCount,
      truncated: table.truncated,
    },
    // A short sample so the customer can eyeball the mapping before committing.
    sample: prepared.slice(0, 10).map((row) => ({
      rowNumber: row.rowNumber,
      phone: row.phone,
      name: row.name,
      status: row.status,
      reason: row.reason,
    })),
  });
}

/** Commit a previewed import into a campaign's audience. */
export async function PATCH(request: Request) {
  const auth = await requireCustomerPermission(request, 'campaigns.manage');
  if (auth.response) return auth.response;
  const body = (await request.json()) as {
    jobId?: string;
    campaignId?: string;
  };
  const jobId = (body.jobId ?? '').trim();
  const campaignId = (body.campaignId ?? '').trim();
  const db = getRawDb();
  const organizationId = auth.session.organizationId!;

  const job = await db
    .prepare(
      `SELECT id, status, accepted_rows FROM import_jobs WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(jobId, organizationId)
    .first<{ id: string; status: string; accepted_rows: number }>();
  if (!job)
    return NextResponse.json({ error: 'Import not found.' }, { status: 404 });
  if (job.status === 'committed')
    return NextResponse.json(
      { error: 'This import was already added to a campaign.' },
      { status: 409 },
    );
  const campaign = await db
    .prepare(
      `SELECT id, status FROM campaigns WHERE id = ? AND organization_id = ? LIMIT 1`,
    )
    .bind(campaignId, organizationId)
    .first<{ id: string; status: string }>();
  if (!campaign)
    return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
  if (!Number(job.accepted_rows))
    return NextResponse.json(
      { error: 'This import has no accepted rows to add.' },
      { status: 409 },
    );

  // Consent is not implied by a spreadsheet: rows land unknown, and the dialer
  // already refuses to call a contact without granted consent.
  const granted = await db
    .prepare(`SELECT phone FROM consent_records
      WHERE organization_id = ? AND status = 'granted'
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now')) LIMIT 20000`)
    .bind(organizationId)
    .all<{ phone: string }>();
  const grantedPhones = new Set(
    (granted.results ?? []).map((row) => row.phone),
  );

  const rows = await db
    .prepare(`SELECT phone, name FROM import_rows
      WHERE import_job_id = ? AND organization_id = ? AND status = 'accepted'`)
    .bind(jobId, organizationId)
    .all<{ phone: string; name: string | null }>();
  const accepted = rows.results ?? [];

  let added = 0;
  for (let start = 0; start < accepted.length; start += 100) {
    const slice = accepted.slice(start, start + 100);
    await db.batch(
      slice.map((row) =>
        db
          .prepare(`INSERT INTO campaign_contacts
            (id, organization_id, campaign_id, phone, status, consent_status)
            VALUES (?, ?, ?, ?, 'pending', ?)
            ON CONFLICT(campaign_id, phone) DO NOTHING`)
          .bind(
            `campaign_contact_${crypto.randomUUID()}`,
            organizationId,
            campaignId,
            row.phone,
            grantedPhones.has(row.phone) ? 'granted' : 'unknown',
          ),
      ),
    );
    added += slice.length;
  }

  const audience = await db
    .prepare(
      `SELECT count(*) AS total FROM campaign_contacts WHERE campaign_id = ?`,
    )
    .bind(campaignId)
    .first<{ total: number }>();
  await db
    .prepare(
      `UPDATE campaigns SET audience_size = ? WHERE id = ? AND organization_id = ?`,
    )
    .bind(Number(audience?.total ?? 0), campaignId, organizationId)
    .run();
  await db
    .prepare(`UPDATE import_jobs SET status = 'committed', campaign_id = ?,
      committed_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(campaignId, jobId)
    .run();

  const withConsent = accepted.filter((row) =>
    grantedPhones.has(row.phone),
  ).length;
  await recordAudit(auth.session, 'import.committed', 'import', jobId, {
    campaignId,
    added,
  });
  return NextResponse.json({
    jobId,
    campaignId,
    added,
    audienceSize: Number(audience?.total ?? 0),
    withConsent,
    // Said plainly: a spreadsheet is not consent, and the dialer enforces that.
    note:
      withConsent < added
        ? `${added - withConsent} contact(s) have no consent record, so the dialer will skip them until consent is captured.`
        : undefined,
  });
}
