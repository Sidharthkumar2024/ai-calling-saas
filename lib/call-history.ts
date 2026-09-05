/**
 * Filtering call history (§19: "Call History supports campaign/date/duration/
 * outcome/recording/transcript/cost filters").
 *
 * What this replaces: a flat `ORDER BY started_at DESC LIMIT 100` with no
 * filters and no total. A workspace with four thousand calls could see the
 * most recent hundred and had no way to reach the rest — and no way to know
 * the rest existed, because nothing said how many there were.
 *
 * Two rules shape it.
 *
 * **The options come from the data, not from a list I wrote.** `outcome` in
 * this database holds two vocabularies laid down at different times plus some
 * free prose from an older path. A hardcoded dropdown would silently hide
 * every row whose outcome I failed to predict, which is worse than no filter:
 * the screen would look complete and be wrong. So the choices are whatever is
 * actually in the workspace's own rows.
 *
 * **An empty result says which kind of empty it is.** "No calls match these
 * filters" and "no calls yet" look identical and mean opposite things — one is
 * a filter to loosen, the other is a product that has not been used.
 *
 * Pure: parsing, validation, the WHERE clause and its bindings. No database.
 */

export type CallFilters = {
  search: string;
  campaignId: string;
  agentId: string;
  outcome: string;
  direction: string;
  channel: string;
  sentiment: string;
  /** ISO dates, inclusive. */
  from: string;
  to: string;
  minSeconds: number | null;
  maxSeconds: number | null;
  minCredits: number | null;
  maxCredits: number | null;
  /** 'any' | 'yes' | 'no' */
  recording: string;
  transcript: string;
};

export const EMPTY_FILTERS: CallFilters = {
  search: '',
  campaignId: '',
  agentId: '',
  outcome: '',
  direction: '',
  channel: '',
  sentiment: '',
  from: '',
  to: '',
  minSeconds: null,
  maxSeconds: null,
  minCredits: null,
  maxCredits: null,
  recording: 'any',
  transcript: 'any',
};

export const PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/**
 * A recording exists only in these states. `pending` is a recording that was
 * asked for and has not arrived, and counting it as present would put a row
 * in front of somebody with a play button that does nothing.
 */
export const RECORDING_PRESENT = ['available', 'demo_available', 'stored'];

const TRISTATE = ['any', 'yes', 'no'];

export function parseFilters(params: URLSearchParams): CallFilters {
  const text = (key: string, max = 80) =>
    (params.get(key) ?? '').trim().slice(0, max);
  const number = (key: string) => {
    const raw = params.get(key);
    if (raw === null || raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const tri = (key: string) => {
    const value = text(key, 8);
    return TRISTATE.includes(value) ? value : 'any';
  };
  // A date that is not a date is dropped rather than passed to SQLite, where
  // it would silently match nothing and read as "you have no calls".
  const date = (key: string) => {
    const value = text(key, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
  };

  const from = date('from');
  const to = date('to');
  return {
    search: text('search', 120),
    campaignId: text('campaign', 140),
    agentId: text('agent', 140),
    outcome: text('outcome', 60),
    direction: text('direction', 20),
    channel: text('channel', 20),
    sentiment: text('sentiment', 20),
    // Backwards dates are a typo, not a query. Swapping them is what the
    // person meant; refusing would be pedantry.
    from: to && from && from > to ? to : from,
    to: to && from && from > to ? from : to,
    minSeconds: number('minSeconds'),
    maxSeconds: number('maxSeconds'),
    minCredits: number('minCredits'),
    maxCredits: number('maxCredits'),
    recording: tri('recording'),
    transcript: tri('transcript'),
  };
}

export function isFiltered(filters: CallFilters): boolean {
  return (
    Boolean(
      filters.search ||
      filters.campaignId ||
      filters.agentId ||
      filters.outcome ||
      filters.direction ||
      filters.channel ||
      filters.sentiment ||
      filters.from ||
      filters.to,
    ) ||
    filters.minSeconds !== null ||
    filters.maxSeconds !== null ||
    filters.minCredits !== null ||
    filters.maxCredits !== null ||
    filters.recording !== 'any' ||
    filters.transcript !== 'any'
  );
}

export type Clause = { sql: string; bindings: unknown[] };

/**
 * Builds the WHERE clause.
 *
 * Every value is a binding — none of these strings is ever concatenated into
 * SQL, because several of them come straight off a query string.
 */
export function buildWhere(
  organizationId: string,
  filters: CallFilters,
): Clause {
  const sql: string[] = ['c.organization_id = ?'];
  const bindings: unknown[] = [organizationId];

  if (filters.search) {
    // The three things somebody actually searches a call list by.
    sql.push(
      "(lower(coalesce(c.customer_name, '')) LIKE ? OR c.from_number LIKE ? OR c.to_number LIKE ?)",
    );
    const like = `%${filters.search.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    bindings.push(like, like, like);
  }
  const equals: Array<[string, string]> = [
    ['c.campaign_id', filters.campaignId],
    ['c.agent_id', filters.agentId],
    ['c.outcome', filters.outcome],
    ['c.direction', filters.direction],
    ['c.channel', filters.channel],
    ['c.sentiment', filters.sentiment],
  ];
  for (const [column, value] of equals)
    if (value) {
      sql.push(`${column} = ?`);
      bindings.push(value);
    }

  if (filters.from) {
    sql.push('date(c.started_at) >= date(?)');
    bindings.push(filters.from);
  }
  if (filters.to) {
    sql.push('date(c.started_at) <= date(?)');
    bindings.push(filters.to);
  }
  if (filters.minSeconds !== null) {
    sql.push('coalesce(c.duration_seconds, 0) >= ?');
    bindings.push(filters.minSeconds);
  }
  if (filters.maxSeconds !== null) {
    sql.push('coalesce(c.duration_seconds, 0) <= ?');
    bindings.push(filters.maxSeconds);
  }
  if (filters.minCredits !== null) {
    sql.push('coalesce(c.cost_credits, 0) >= ?');
    bindings.push(filters.minCredits);
  }
  if (filters.maxCredits !== null) {
    sql.push('coalesce(c.cost_credits, 0) <= ?');
    bindings.push(filters.maxCredits);
  }

  const recordingList = RECORDING_PRESENT.map(() => '?').join(', ');
  if (filters.recording === 'yes') {
    sql.push(`c.recording_status IN (${recordingList})`);
    bindings.push(...RECORDING_PRESENT);
  }
  if (filters.recording === 'no') {
    sql.push(
      `(c.recording_status IS NULL OR c.recording_status NOT IN (${recordingList}))`,
    );
    bindings.push(...RECORDING_PRESENT);
  }

  // A transcript row exists but can be empty — a call that connected and said
  // nothing. Empty is "no transcript" to anybody looking for one to read.
  if (filters.transcript === 'yes')
    sql.push("trim(coalesce(t.full_text, '')) != ''");
  if (filters.transcript === 'no')
    sql.push("trim(coalesce(t.full_text, '')) = ''");

  return { sql: sql.join(' AND '), bindings };
}

export function boundedPage(input: { page?: unknown; pageSize?: unknown }): {
  limit: number;
  offset: number;
  page: number;
} {
  const size = Number(input.pageSize);
  const limit =
    Number.isFinite(size) && size > 0
      ? Math.min(MAX_PAGE_SIZE, Math.round(size))
      : PAGE_SIZE;
  const raw = Number(input.page);
  const page = Number.isFinite(raw) && raw > 1 ? Math.round(raw) : 1;
  return { limit, offset: (page - 1) * limit, page };
}

export type EmptyKind = 'no_calls' | 'no_matches';

/**
 * Which kind of empty this is.
 *
 * The two look identical on screen and mean opposite things: one is a filter
 * to loosen, the other is a product nobody has used yet.
 */
export function emptyKind(input: {
  total: number;
  filtered: boolean;
}): EmptyKind | null {
  if (input.total > 0) return null;
  return input.filtered ? 'no_matches' : 'no_calls';
}

export function emptyMessage(kind: EmptyKind): string {
  return kind === 'no_matches'
    ? 'No calls match these filters. Clear one and try again.'
    : 'No calls yet. They appear here as soon as your agent takes or places one.';
}

/** How the result should describe itself: "Showing 1–50 of 4,312". */
export function rangeLabel(input: {
  page: number;
  limit: number;
  returned: number;
  total: number;
}): string {
  if (input.total === 0) return 'Nothing to show';
  const first = (input.page - 1) * input.limit + 1;
  const last = first + input.returned - 1;
  const totalText = input.total.toLocaleString('en-IN');
  return first === last
    ? `Showing ${first} of ${totalText}`
    : `Showing ${first}–${last} of ${totalText}`;
}

export function totalPages(total: number, limit: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, limit)));
}
