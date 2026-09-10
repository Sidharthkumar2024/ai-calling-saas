/**
 * Which data a scheduled report is actually about.
 *
 * The report builder branched on `qa`, `quality`, `leads`, `conversion`,
 * `cost` and `usage`, and the screen that creates reports offers
 * `call_performance`, `agent_productivity`, `lead_conversion`,
 * `campaign_outcomes` and `spend`. Not one of the five matched a branch, and
 * the route stored whatever the body said without checking, so every report a
 * customer ever scheduled fell through to the default and arrived as a CSV of
 * raw call records — under its own name, with a summary counting calls and
 * credits, whatever it had been asked for.
 *
 * The names now live in one place, and the type is checked when the report is
 * created rather than silently substituted when it runs. The old branch names
 * still resolve, because an API client may have been written against them and
 * a stored row certainly was.
 */

/** What the screen offers, and the only values it will now accept. */
export const REPORT_TYPES = [
  'call_performance',
  'agent_productivity',
  'lead_conversion',
  'campaign_outcomes',
  'spend',
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

/** The shapes of data a report can be built from. */
export const REPORT_DATASETS = [
  'calls',
  'agents',
  'campaigns',
  'leads',
  'usage',
  'quality',
] as const;

export type ReportDataset = (typeof REPORT_DATASETS)[number];

/**
 * Every name that resolves, including the ones only the builder ever knew.
 * `operations` is here because the seeded demo report was created with it.
 */
const DATASET_OF: Record<string, ReportDataset> = {
  call_performance: 'calls',
  calls: 'calls',
  operations: 'calls',
  agent_productivity: 'agents',
  agents: 'agents',
  campaign_outcomes: 'campaigns',
  campaigns: 'campaigns',
  lead_conversion: 'leads',
  leads: 'leads',
  conversion: 'leads',
  spend: 'usage',
  cost: 'usage',
  usage: 'usage',
  qa: 'quality',
  quality: 'quality',
};

export function isReportType(value: unknown): value is ReportType {
  return (REPORT_TYPES as readonly string[]).includes(String(value));
}

/**
 * Null for a name nothing can be built from.
 *
 * Deliberately not a default. A report that cannot be built should fail where
 * somebody can see it failed, rather than arrive full of the wrong rows with
 * the right name on the subject line.
 */
export function datasetFor(reportType: unknown): ReportDataset | null {
  // Only a string is a report type. Anything else is no name at all, not a
  // name that happens to stringify.
  const name =
    typeof reportType === 'string' ? reportType.trim().toLowerCase() : '';
  return DATASET_OF[name] ?? null;
}

export function unknownReportMessage(reportType: unknown): string {
  const name = typeof reportType === 'string' ? reportType.trim() : '';
  return `${name ? `“${name}”` : 'That'} is not a kind of report this can build, so nothing was sent. Edit the report and choose what it should cover.`;
}
