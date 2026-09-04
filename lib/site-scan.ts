import {
  auditPage,
  checkSiteUrl,
  countBySeverity,
  dedupePages,
  extractPageFacts,
  internalLinksFrom,
  rankFindings,
  type Finding,
  type PageFacts,
} from '@/lib/site-audit';

/**
 * Fetches a workspace's own site and audits it (§6).
 *
 * Every step is timed and recorded, because the trace is not decoration: a scan
 * that says "5 pages analysed" and shows nothing else asks to be trusted, and
 * a scan that lists each URL with the milliseconds it took can be checked. It
 * also makes a slow or blocked site diagnosable instead of mysterious.
 *
 * Deliberately conservative. Same origin only, a hard page cap, a per-request
 * timeout and a total budget — a crawler running inside the platform on a URL
 * a customer typed is a liability if any of those is missing.
 */

export type ScanStep = {
  label: string;
  detail?: string;
  ms: number;
  ok: boolean;
};

export type ScanResult = {
  ok: boolean;
  host?: string;
  reason?: string;
  steps: ScanStep[];
  pages: PageFacts[];
  findings: Finding[];
  counts: { high: number; medium: number; low: number };
  totalMs: number;
};

const MAX_PAGES = 8;
const PER_REQUEST_MS = 8000;
const TOTAL_BUDGET_MS = 45_000;
const MAX_BYTES = 1_500_000;

/** Paths worth trying when a site publishes no sitemap. */
const LIKELY_PATHS = [
  '/',
  '/pricing',
  '/features',
  '/about',
  '/contact',
  '/services',
  '/products',
];

async function timed<T>(
  steps: ScanStep[],
  label: string,
  detail: string | undefined,
  run: () => Promise<T>,
): Promise<T | null> {
  const started = Date.now();
  try {
    const value = await run();
    steps.push({ label, detail, ms: Date.now() - started, ok: true });
    return value;
  } catch (error) {
    steps.push({
      label,
      detail: `${detail ?? ''}${detail ? ' — ' : ''}${
        error instanceof Error ? error.message : 'failed'
      }`,
      ms: Date.now() - started,
      ok: false,
    });
    return null;
  }
}

async function fetchPage(url: string) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      // Identifies the crawler honestly. A scanner that disguises itself as a
      // browser is one a site owner cannot block, which is not a position to
      // put a customer's own site in.
      'user-agent':
        'VaaniGrowthBot/1.0 (+website audit requested by the site owner)',
      accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(PER_REQUEST_MS),
  });
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('html'))
    throw new Error(`not HTML (${type.split(';')[0] || 'unknown'})`);
  const html = (await response.text()).slice(0, MAX_BYTES);
  return { status: response.status, html };
}

export async function scanSite(rawUrl: string): Promise<ScanResult> {
  const started = Date.now();
  const steps: ScanStep[] = [];
  const check = checkSiteUrl(rawUrl);
  if (!check.ok)
    return {
      ok: false,
      reason: check.reason,
      steps,
      pages: [],
      findings: [],
      counts: { high: 0, medium: 0, low: 0 },
      totalMs: 0,
    };

  const { origin, host } = check;
  const queue: string[] = [];
  const seen = new Set<string>();

  // Sitemap first: it is the site's own statement of what matters, and guessing
  // paths is what you do when it is absent, not instead of asking.
  const sitemap = await timed(
    steps,
    'Discovering sitemap',
    `${origin}/sitemap.xml`,
    async () => {
      const response = await fetch(`${origin}/sitemap.xml`, {
        signal: AbortSignal.timeout(PER_REQUEST_MS),
      });
      if (!response.ok) throw new Error(`no sitemap (${response.status})`);
      return (await response.text()).slice(0, MAX_BYTES);
    },
  );
  if (sitemap)
    for (const match of sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      try {
        const url = new URL(match[1]);
        if (url.origin === origin) queue.push(url.toString());
      } catch {
        /* a malformed <loc> is skipped, not fatal */
      }
    }

  if (!queue.length) {
    steps.push({
      label: 'No sitemap — using the home page and common paths',
      ms: 0,
      ok: true,
    });
    for (const path of LIKELY_PATHS) queue.push(`${origin}${path}`);
  }
  queue.unshift(origin + '/');

  const pages: PageFacts[] = [];
  let discovered = false;
  for (const url of queue) {
    if (pages.length >= MAX_PAGES) break;
    if (Date.now() - started > TOTAL_BUDGET_MS) {
      steps.push({ label: 'Stopped at the time budget', ms: 0, ok: true });
      break;
    }
    const normalised = url.replace(/#.*$/, '');
    if (seen.has(normalised)) continue;
    seen.add(normalised);

    const fetched = await timed(steps, 'Reading page', normalised, () =>
      fetchPage(normalised),
    );
    if (!fetched) continue;
    const facts = extractPageFacts({
      url: normalised,
      status: fetched.status,
      html: fetched.html,
    });
    pages.push(facts);

    // Only the home page contributes new links, and only when the sitemap gave
    // us nothing: following links from every page is a crawl, and a crawl of
    // somebody's site is not what was asked for.
    if (!discovered && !sitemap) {
      discovered = true;
      for (const link of internalLinksFrom(fetched.html, origin))
        if (!seen.has(link) && queue.length < MAX_PAGES * 3) queue.push(link);
    }
  }

  if (!pages.length)
    return {
      ok: false,
      host,
      reason: `Nothing could be read from ${host}. Check the address is public and reachable.`,
      steps,
      pages: [],
      findings: [],
      counts: { high: 0, medium: 0, low: 0 },
      totalMs: Date.now() - started,
    };

  // Sites that answer unknown paths with the home page instead of a 404 would
  // otherwise be audited seven times over, reporting the same problem seven
  // times and burying whatever is real.
  const { pages: distinct, duplicates } = dedupePages(pages);
  if (duplicates.length)
    steps.push({
      label: 'Ignoring duplicate pages',
      detail: `${duplicates.slice(0, 5).join(', ')} served content already seen`,
      ms: 0,
      ok: true,
    });

  const findings = rankFindings(distinct.flatMap((page) => auditPage(page)));
  steps.push({
    label: 'Auditing pages',
    detail: `${distinct.length} pages, ${findings.length} findings`,
    ms: 0,
    ok: true,
  });

  return {
    ok: true,
    host,
    steps,
    pages: distinct,
    findings,
    counts: countBySeverity(findings),
    totalMs: Date.now() - started,
  };
}
