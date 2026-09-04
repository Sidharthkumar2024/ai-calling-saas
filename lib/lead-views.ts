/**
 * CRM views, filters and deduplication (Blueprint §3.5).
 *
 * The CRM had one view — a Kanban — a search box and a source dropdown. §3.5
 * asks for a List/Table view with a one-click switch, filters across ten
 * dimensions, saved named views, bulk actions, and phone/email deduplication
 * with merge.
 *
 * Pure: filtering, duplicate detection and merge planning. Deduplication is
 * the part that needs care rather than code — merging two leads destroys one of
 * them, and a merge that silently picks a winner for a conflicting field is how
 * a business loses the phone number it was actually reaching somebody on. So
 * this module plans a merge and reports what it cannot decide; it never decides
 * those itself.
 */

export const LEAD_VIEWS = ['kanban', 'list'] as const;
export type LeadView = (typeof LEAD_VIEWS)[number];

export type LeadRecord = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  score: number;
  intent: string;
  status: string;
  stage: string;
  owner: string;
  source_type: string;
  source_name: string;
  campaign_name?: string | null;
  product_interest?: string | null;
  estimated_value: number;
  captured_at: string;
  ai_summary: string;
  next_action: string;
};

export type LeadFilters = {
  /** Free text across name, phone, email, source, campaign, interest. */
  query?: string;
  stage?: string;
  owner?: string;
  sourceType?: string;
  campaign?: string;
  status?: string;
  intent?: string;
  minScore?: number | null;
  maxScore?: number | null;
  /** ISO dates; inclusive. */
  capturedFrom?: string | null;
  capturedTo?: string | null;
};

export const EMPTY_FILTERS: LeadFilters = {};

const text = (value: unknown) =>
  typeof value === 'string' ? value.toLowerCase() : '';

/**
 * Normalises a phone number for comparison.
 *
 * Keeps the last ten digits. A lead captured as `+91 98123 45678`, one typed as
 * `098123-45678` and one imported as `9812345678` are the same person, and a
 * dedupe that compares the stored strings finds none of them. Ten digits
 * because that is what an Indian subscriber number is; comparing full E.164
 * would make the country code decide, and it is exactly the part people omit.
 */
export function normalisePhone(value: unknown): string {
  const digits = scalar(value).replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function normaliseEmail(value: unknown): string {
  return scalar(value).trim().toLowerCase();
}

/**
 * Scalar-only coercion.
 *
 * These records come off a JSON API, so a field can arrive as an object if
 * something upstream changes shape. Stringifying that gives "[object Object]",
 * which would then be treated as a phone number or an email address.
 */
function scalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}

/** Whether one lead passes the filter set. */
export function matchesFilters(
  lead: LeadRecord,
  filters: LeadFilters,
): boolean {
  const f = filters ?? {};
  if (f.query) {
    const needle = f.query.trim().toLowerCase();
    if (needle) {
      const haystack = [
        lead.name,
        lead.phone,
        lead.email,
        lead.source_name,
        lead.campaign_name,
        lead.product_interest,
      ]
        .map(text)
        .join(' ');
      // Digits in the query match the number however either side is
      // punctuated, so searching "9812345678" finds "+91 98123 45678".
      const digits = needle.replace(/\D/g, '');
      const phoneHit =
        digits.length >= 4 && normalisePhone(lead.phone).includes(digits);
      if (!haystack.includes(needle) && !phoneHit) return false;
    }
  }
  const equals = (
    value: string | undefined,
    against: string | null | undefined,
  ) => !value || value === 'all' || text(against) === text(value);
  if (!equals(f.stage, lead.stage)) return false;
  if (!equals(f.owner, lead.owner)) return false;
  if (!equals(f.sourceType, lead.source_type)) return false;
  if (!equals(f.campaign, lead.campaign_name)) return false;
  if (!equals(f.status, lead.status)) return false;
  if (!equals(f.intent, lead.intent)) return false;

  const score = Number(lead.score ?? 0);
  if (f.minScore !== null && f.minScore !== undefined && score < f.minScore)
    return false;
  if (f.maxScore !== null && f.maxScore !== undefined && score > f.maxScore)
    return false;

  // Dates compare on the date part only: a filter of "captured on the 4th"
  // must include a lead captured at 23:50 on the 4th.
  const captured = String(lead.captured_at ?? '').slice(0, 10);
  if (f.capturedFrom && captured && captured < f.capturedFrom.slice(0, 10))
    return false;
  if (f.capturedTo && captured && captured > f.capturedTo.slice(0, 10))
    return false;
  return true;
}

export function applyFilters(
  leads: LeadRecord[],
  filters: LeadFilters,
): LeadRecord[] {
  return (leads ?? []).filter((lead) => matchesFilters(lead, filters));
}

/** Distinct values for a field, for building the filter dropdowns. */
export function filterOptions(leads: LeadRecord[]) {
  const collect = (pick: (lead: LeadRecord) => string | null | undefined) =>
    [
      ...new Set(
        (leads ?? [])
          .map((lead) => (pick(lead) ?? '').toString().trim())
          .filter(Boolean),
      ),
    ].sort();
  return {
    stages: collect((lead) => lead.stage),
    owners: collect((lead) => lead.owner),
    sourceTypes: collect((lead) => lead.source_type),
    campaigns: collect((lead) => lead.campaign_name),
    statuses: collect((lead) => lead.status),
    intents: collect((lead) => lead.intent),
  };
}

export type DuplicateGroup = {
  /** What matched: a phone number or an email address. */
  on: 'phone' | 'email';
  key: string;
  leads: LeadRecord[];
};

/**
 * Finds leads that are the same person.
 *
 * Phone first, because it is the field this product actually dials and the one
 * most likely to be present. Email groups are only reported when they are not
 * already covered by a phone group, so the same pair is not offered twice.
 *
 * A blank or implausibly short number is never a match key: half the leads in a
 * bad import share an empty phone, and grouping those would offer to merge
 * unrelated people.
 */
export function findDuplicates(leads: LeadRecord[]): DuplicateGroup[] {
  const byPhone = new Map<string, LeadRecord[]>();
  const byEmail = new Map<string, LeadRecord[]>();
  for (const lead of leads ?? []) {
    const phone = normalisePhone(lead.phone);
    if (phone.length >= 10) {
      const bucket = byPhone.get(phone) ?? [];
      bucket.push(lead);
      byPhone.set(phone, bucket);
    }
    const email = normaliseEmail(lead.email);
    if (email.includes('@')) {
      const bucket = byEmail.get(email) ?? [];
      bucket.push(lead);
      byEmail.set(email, bucket);
    }
  }

  const groups: DuplicateGroup[] = [];
  const paired = new Set<string>();
  const pairKey = (group: LeadRecord[]) =>
    group
      .map((lead) => lead.id)
      .sort()
      .join('|');

  for (const [key, group] of byPhone)
    if (group.length > 1) {
      groups.push({ on: 'phone', key, leads: group });
      paired.add(pairKey(group));
    }
  for (const [key, group] of byEmail)
    if (group.length > 1 && !paired.has(pairKey(group)))
      groups.push({ on: 'email', key, leads: group });

  // Groups are deliberately not chained transitively. A lead sharing a phone
  // with one and an email with another is, transitively, all three people —
  // and chaining is exactly how a shared family or office address merges
  // strangers. Two reviewable groups is the honest answer: a person decides
  // each, and neither decision is made for them.
  //
  // Most duplicates first: a number captured five times is worth cleaning up
  // before a pair.
  return groups.sort((a, b) => b.leads.length - a.leads.length);
}

export type MergePlan = {
  primaryId: string;
  mergedIds: string[];
  /** Fields the primary is missing that a duplicate can supply. */
  fill: Record<string, string>;
  /**
   * Fields where the leads genuinely disagree.
   *
   * Reported rather than resolved. A merge that silently picks one of two
   * different email addresses is how a business loses the one it was actually
   * reaching somebody on, and nothing here knows which is right.
   */
  conflicts: Array<{ field: string; values: string[] }>;
  /** The highest score across the group; a merge must not lower it. */
  score: number;
};

/**
 * Reads a field as text, refusing to stringify anything that is not scalar.
 *
 * These records arrive from a JSON API, so a field can be an object or an
 * array if something upstream changed shape. Coercing that gives
 * "[object Object]", which would then be merged into a lead as if it were a
 * name.
 */
function fieldText(source: unknown, field: string): string {
  const value = (source as Record<string, unknown> | null)?.[field];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}

/** Field-appropriate equality: a phone by its digits, an email case-folded. */
function sameValue(field: string, a: string, b: string): boolean {
  if (field === 'phone') return normalisePhone(a) === normalisePhone(b);
  if (field === 'email') return normaliseEmail(a) === normaliseEmail(b);
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

const MERGEABLE_FIELDS = [
  'name',
  'email',
  'phone',
  'campaign_name',
  'product_interest',
] as const;

/**
 * Plans a merge without performing one.
 *
 * The primary is the lead that survives. Everything the primary is missing and
 * a duplicate has is offered as a fill; everything both have and disagree on is
 * reported as a conflict for a person to settle. The score is the maximum
 * across the group, because a lead's score is evidence accumulated from calls
 * and merging must not throw the best of it away.
 */
export function planMerge(
  primary: LeadRecord,
  duplicates: LeadRecord[],
): MergePlan {
  const others = (duplicates ?? []).filter((lead) => lead.id !== primary.id);
  const fill: Record<string, string> = {};
  const conflicts: MergePlan['conflicts'] = [];

  for (const field of MERGEABLE_FIELDS) {
    const own = fieldText(primary, field);
    const values = [
      ...new Set(others.map((lead) => fieldText(lead, field)).filter(Boolean)),
    ];
    if (!own) {
      // Nothing to lose: the first duplicate that has it supplies it.
      if (values.length === 1) fill[field] = values[0];
      else if (values.length > 1) conflicts.push({ field, values });
      continue;
    }
    // Compared field-appropriately, not as raw text. "+91 98765 43210" and
    // "9876543210" are the same number — that is the whole premise of the
    // duplicate detection above — so reporting them as a disagreement would
    // make this module contradict itself and bury the real conflicts in noise.
    const different = values.filter((value) => !sameValue(field, own, value));
    if (different.length)
      conflicts.push({ field, values: [own, ...different] });
  }

  return {
    primaryId: primary.id,
    mergedIds: others.map((lead) => lead.id),
    fill,
    conflicts,
    score: Math.max(
      Number(primary.score ?? 0),
      ...others.map((lead) => Number(lead.score ?? 0)),
      0,
    ),
  };
}

export const BULK_ACTIONS = ['assign_owner', 'move_stage', 'archive'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export function isBulkAction(value: unknown): value is BulkAction {
  return (
    typeof value === 'string' &&
    (BULK_ACTIONS as readonly string[]).includes(value)
  );
}

/**
 * Renders the selected leads as CSV.
 *
 * §3.5 lists export as a bulk action. Done here rather than server-side
 * because the selection and the visible columns are a client concern, and a
 * person exporting what they are looking at should get exactly that.
 */
export function toCsv(leads: LeadRecord[]): string {
  const columns = [
    'name',
    'phone',
    'email',
    'score',
    'stage',
    'owner',
    'status',
    'intent',
    'source_name',
    'campaign_name',
    'product_interest',
    'estimated_value',
    'captured_at',
  ] as const;
  const escape = (raw: string) => {
    // A lead name containing a comma or a quote must not shift every later
    // column, and a leading = or + is a spreadsheet formula injection.
    const guarded = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return /[",\n]/.test(guarded)
      ? `"${guarded.replaceAll('"', '""')}"`
      : guarded;
  };
  const rows = (leads ?? []).map((lead) =>
    columns.map((column) => escape(fieldText(lead, column))).join(','),
  );
  return [columns.join(','), ...rows].join('\n');
}
