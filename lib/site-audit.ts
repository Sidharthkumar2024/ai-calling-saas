/**
 * Website scan and page findings (Blueprint §6).
 *
 * §6 asks for an "authorized website scraping/indexing to understand offers and
 * pages". This is the half that decides what the scan is worth: turning fetched
 * HTML into findings that name the page, the measured value, and what to do.
 *
 * The rule from the evidence board carries over unchanged — a finding must
 * carry the fact it is derived from. "Improve your homepage SEO" is advice
 * nobody can act on or check. "The homepage title is 12 characters, so it wins
 * nothing in search" is a fact with an action attached.
 *
 * Pure: URL safety, HTML fact extraction and finding derivation. The fetching
 * lives in `lib/site-scan.ts`.
 */

export type UrlCheck =
  | { ok: true; url: string; origin: string; host: string }
  | { ok: false; reason: string };

/**
 * Hostnames a workspace must never be able to make the server fetch.
 *
 * This endpoint takes a URL from a customer and fetches it from inside the
 * platform, which is a server-side request forgery primitive unless it is
 * fenced. Cloud metadata endpoints are the classic target — `169.254.169.254`
 * hands out credentials on several providers — and loopback reaches whatever
 * else is listening in the same network.
 */
const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254',
  'metadata.google.internal',
]);

function isPrivateAddress(host: string): boolean {
  // IPv4 private and link-local ranges.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }
  // IPv6 loopback, unique-local and link-local.
  const lower = host.toLowerCase();
  if (lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe80')) return true;
  return false;
}

/**
 * Validates a customer-supplied site URL before anything fetches it.
 *
 * Refuses rather than repairs where the input is ambiguous: guessing that
 * `http://internal` meant something public is exactly the guess that turns this
 * into an internal port scanner.
 */
export function checkSiteUrl(raw: string): UrlCheck {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: false, reason: 'Enter your website address.' };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, reason: 'That does not look like a web address.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return { ok: false, reason: 'Only http and https addresses can be read.' };
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTS.has(host) || isPrivateAddress(host))
    return {
      ok: false,
      reason: 'That address is on a private network and cannot be read.',
    };
  // A bare hostname with no dot is a machine on the local network, not a site.
  if (!host.includes('.'))
    return { ok: false, reason: 'Enter a full domain, such as example.com.' };
  return { ok: true, url: url.toString(), origin: url.origin, host };
}

export type PageFacts = {
  url: string;
  path: string;
  status: number;
  title: string;
  metaDescription: string;
  h1: string[];
  h2: string[];
  wordCount: number;
  internalLinks: number;
  /** Text of anything that looks like a call to action. */
  ctas: string[];
  hasForm: boolean;
  /**
   * The page builds its content in the browser, so the HTML a crawler receives
   * is close to empty. Distinguishing this from a genuinely thin page matters:
   * a human sees a full page here, and telling somebody to "add more copy" to
   * a page that already has plenty is advice that destroys trust in the rest
   * of the report.
   */
  clientRendered: boolean;
  /** Bytes of HTML, for the trace. */
  bytes: number;
};

const stripTags = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const decode = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

/** Below this a page cannot answer much; also the client-render threshold. */
const THIN_CONTENT_WORDS = 250;

const CTA_WORDS =
  /\b(buy|start|get started|book|demo|sign ?up|subscribe|contact|request|try|schedule|talk to|call us|order|checkout|purchase)\b/i;

/**
 * Reads the facts a finding can be built on.
 *
 * Regex rather than a DOM parser because the worker has no DOM and shipping one
 * to read six fields would be the larger mistake. Every field here is one a
 * finding cites by value, so a wrong read shows up as an obviously wrong
 * number rather than as silently worse advice.
 */
export function extractPageFacts(input: {
  url: string;
  status: number;
  html: string;
}): PageFacts {
  const html = String(input.html ?? '');
  const title = decode(
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '',
  );
  const metaDescription = decode(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(
      html,
    )?.[1] ??
      /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(
        html,
      )?.[1] ??
      '',
  );
  const headings = (level: 'h1' | 'h2') =>
    [
      ...html.matchAll(
        new RegExp(`<${level}[^>]*>([\\s\\S]*?)</${level}>`, 'gi'),
      ),
    ]
      .map((match) => decode(stripTags(match[1])))
      .filter(Boolean)
      .slice(0, 12);

  const body = stripTags(html);
  let path = '/';
  try {
    path = new URL(input.url).pathname || '/';
  } catch {
    path = '/';
  }
  const anchors = [
    ...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi),
  ];
  const internalLinks = anchors.filter(([, href]) => {
    const value = href.trim();
    return (
      value.startsWith('/') ||
      (!/^https?:/i.test(value) &&
        !value.startsWith('#') &&
        !value.startsWith('mailto:'))
    );
  }).length;
  const ctas = [
    ...new Set(
      anchors
        .map(([, , label]) => decode(stripTags(label)))
        .filter((label) => label.length > 1 && CTA_WORDS.test(label))
        .concat(
          [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gi)]
            .map((match) => decode(stripTags(match[1])))
            .filter((label) => label.length > 1 && CTA_WORDS.test(label)),
        ),
    ),
  ].slice(0, 8);

  return {
    url: input.url,
    path,
    status: Number(input.status) || 0,
    title,
    metaDescription,
    h1: headings('h1'),
    h2: headings('h2'),
    wordCount: body ? body.split(' ').length : 0,
    internalLinks,
    ctas,
    hasForm: /<form\b/i.test(html),
    // Little visible text but plenty of script is the signature of a
    // client-rendered app shell, not of an empty page.
    clientRendered:
      (body ? body.split(' ').length : 0) < THIN_CONTENT_WORDS &&
      (html.match(/<script/gi)?.length ?? 0) >= 3,
    bytes: html.length,
  };
}

/** Links worth following, for page discovery. */
export function internalLinksFrom(html: string, origin: string): string[] {
  const found = new Set<string>();
  for (const match of String(html ?? '').matchAll(
    /<a\b[^>]*href=["']([^"']+)["']/gi,
  )) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript):/i.test(raw))
      continue;
    let resolved: URL;
    try {
      resolved = new URL(raw, origin);
    } catch {
      continue;
    }
    // Same origin only. Following outbound links would crawl the internet on
    // the customer's behalf, which is neither asked for nor defensible.
    if (resolved.origin !== origin) continue;
    if (
      /\.(png|jpe?g|gif|svg|webp|pdf|zip|css|js|ico|woff2?)$/i.test(
        resolved.pathname,
      )
    )
      continue;
    resolved.hash = '';
    found.add(resolved.toString());
  }
  return [...found];
}

/**
 * A cheap fingerprint of what a page actually says.
 *
 * Many sites answer every unknown path with the home page instead of a 404 — a
 * "soft 404". Guessing paths on such a site returns the same document seven
 * times, and auditing each copy separately reported the same problem seven
 * times: 28 findings where four were real, which is a report nobody reads.
 *
 * Title plus first words of body, because that is what distinguishes two pages
 * to a reader and to a search engine. Not a hash of the HTML: two genuinely
 * different pages share a template and would differ only in whitespace.
 */
export function contentFingerprint(facts: PageFacts): string {
  const body = facts.wordCount ? `${facts.wordCount}` : '0';
  return [
    facts.title.toLowerCase().trim(),
    facts.h1.join('|').toLowerCase().trim(),
    body,
  ].join('::');
}

export type DedupedPages = {
  pages: PageFacts[];
  /** Paths dropped because they served an existing page's content. */
  duplicates: string[];
};

/**
 * Keeps one page per distinct document.
 *
 * The shallowest path wins, since that is the canonical one — a site serving
 * the home page at `/pricing` has a home page, not a pricing page.
 */
export function dedupePages(pages: PageFacts[]): DedupedPages {
  const byFingerprint = new Map<string, PageFacts>();
  const duplicates: string[] = [];
  const depth = (path: string) => path.split('/').filter(Boolean).length;
  for (const page of pages ?? []) {
    const key = contentFingerprint(page);
    const existing = byFingerprint.get(key);
    if (!existing) {
      byFingerprint.set(key, page);
      continue;
    }
    const loser = depth(page.path) < depth(existing.path) ? existing : page;
    const winner = loser === page ? existing : page;
    byFingerprint.set(key, winner);
    duplicates.push(loser.path);
  }
  return { pages: [...byFingerprint.values()], duplicates };
}

export type Severity = 'high' | 'medium' | 'low';

export type Finding = {
  id: string;
  page: string;
  title: string;
  /** The instruction. Specific enough to hand to somebody. */
  doThis: string;
  why: string;
  /** The measured fact this rests on. */
  evidence: string;
  severity: Severity;
  area: 'seo' | 'conversion' | 'content' | 'structure';
};

/** Search engines truncate around here, and short titles waste the slot. */
const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESCRIPTION_MIN = 70;

/**
 * Derives findings from one page's facts.
 *
 * Every branch quotes the value it fired on. A finding that cannot state its
 * own number is not produced, which is why there is no generic "improve this
 * page" case: there is nothing to cite.
 */
export function auditPage(facts: PageFacts): Finding[] {
  const findings: Finding[] = [];
  const at = (suffix: string) => `${facts.path}:${suffix}`;
  const label = facts.path === '/' ? 'the homepage' : facts.path;

  if (!facts.title)
    findings.push({
      id: at('title-missing'),
      page: facts.path,
      title: `${label} has no title tag`,
      doThis:
        'Add a <title> naming what the page offers and who it is for, in about 50 characters.',
      why: 'The title is the line shown in search results; without one the search engine invents it.',
      evidence: 'No <title> element was found on the page.',
      severity: 'high',
      area: 'seo',
    });
  else if (facts.title.length < TITLE_MIN)
    findings.push({
      id: at('title-short'),
      page: facts.path,
      title: `The title on ${label} is too short to rank for anything`,
      doThis: `Rewrite the title to around ${TITLE_MAX} characters, leading with the term buyers actually search for.`,
      why: 'A short title leaves most of the search result slot unused and carries fewer terms to match against.',
      evidence: `Title is ${facts.title.length} characters: “${facts.title}”.`,
      severity: 'medium',
      area: 'seo',
    });
  else if (facts.title.length > TITLE_MAX + 15)
    findings.push({
      id: at('title-long'),
      page: facts.path,
      title: `The title on ${label} will be cut off in search`,
      doThis: `Trim the title to about ${TITLE_MAX} characters, keeping the important words first.`,
      why: 'Search results truncate long titles, so anything past the cut is not read.',
      evidence: `Title is ${facts.title.length} characters: “${facts.title}”.`,
      severity: 'low',
      area: 'seo',
    });

  if (!facts.metaDescription)
    findings.push({
      id: at('description-missing'),
      page: facts.path,
      title: `${label} has no meta description`,
      doThis:
        'Add a meta description of roughly 150 characters that states the offer and one reason to click.',
      why: 'Without one the search engine pastes an arbitrary sentence from the page under your result.',
      evidence: 'No meta description was found.',
      severity: 'medium',
      area: 'seo',
    });
  else if (facts.metaDescription.length < DESCRIPTION_MIN)
    findings.push({
      id: at('description-short'),
      page: facts.path,
      title: `The description on ${label} is too short to persuade`,
      doThis:
        'Expand it to about 150 characters, stating the offer and one reason to click.',
      why: 'A short description wastes the only sales copy you control in a search result.',
      evidence: `Description is ${facts.metaDescription.length} characters.`,
      severity: 'low',
      area: 'seo',
    });

  if (facts.h1.length === 0 && !facts.clientRendered)
    findings.push({
      id: at('h1-missing'),
      page: facts.path,
      title: `${label} has no H1`,
      doThis:
        'Add a single H1 that repeats the page’s main term in plain language.',
      why: 'The H1 is the strongest on-page signal of what a page is about, for readers and for search.',
      evidence: 'No <h1> element was found.',
      severity: 'high',
      area: 'seo',
    });
  else if (facts.h1.length > 1)
    findings.push({
      id: at('h1-many'),
      page: facts.path,
      title: `${label} has ${facts.h1.length} H1 headings`,
      doThis:
        'Keep one H1 and demote the rest to H2, so the page states one subject.',
      why: 'Several H1s split the page’s subject and weaken all of them.',
      evidence: `H1s found: ${facts.h1
        .slice(0, 3)
        .map((h) => `“${h}”`)
        .join(', ')}.`,
      severity: 'low',
      area: 'structure',
    });

  if (facts.wordCount > 0 && facts.wordCount < THIN_CONTENT_WORDS) {
    if (facts.clientRendered)
      findings.push({
        id: at('client-rendered'),
        page: facts.path,
        title: `${label} is built in the browser, so search engines see almost nothing`,
        doThis:
          'Server-render this page, or pre-render its text into the initial HTML, so the content is present before any JavaScript runs.',
        why: 'A visitor sees the full page, but a crawler that does not run JavaScript receives an empty shell — and that shell is what gets indexed.',
        evidence: `The delivered HTML contains about ${facts.wordCount} words of text alongside the page scripts.`,
        severity: 'high',
        area: 'structure',
      });
    else
      findings.push({
        id: at('thin'),
        page: facts.path,
        title: `${label} is too thin to answer a buyer’s question`,
        doThis:
          'Add the specifics a buyer asks before deciding: what is included, what it costs, who it suits, what happens next.',
        why: 'A page with little text cannot match many searches and gives a visitor no reason to continue.',
        evidence: `The page has about ${facts.wordCount} words of visible text.`,
        severity: facts.wordCount < 120 ? 'high' : 'medium',
        area: 'content',
      });
  }

  // On a client-rendered page the absence of a link, button or form in the
  // HTML says nothing about what the visitor is shown, so the claim is not
  // made at all rather than made wrongly.
  if (facts.ctas.length === 0 && !facts.hasForm && !facts.clientRendered)
    findings.push({
      id: at('no-cta'),
      page: facts.path,
      title: `${label} asks the visitor to do nothing`,
      doThis:
        'Add one clear action — book, buy, or talk to us — repeated near the top and at the end.',
      why: 'A page with no action collects no leads however much traffic reaches it.',
      evidence: 'No call-to-action link, button or form was found on the page.',
      severity: 'high',
      area: 'conversion',
    });

  return findings;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

/** Worst first, and within a severity the homepage before deeper pages. */
export function rankFindings(findings: Finding[]): Finding[] {
  return [...(findings ?? [])].sort((a, b) => {
    const severity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (severity !== 0) return severity;
    if (a.page === '/' && b.page !== '/') return -1;
    if (b.page === '/' && a.page !== '/') return 1;
    return a.page.localeCompare(b.page);
  });
}

export function countBySeverity(findings: Finding[]) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const finding of findings ?? []) counts[finding.severity] += 1;
  return counts;
}
