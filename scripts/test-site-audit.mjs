import assert from 'node:assert/strict';

import {
  auditPage,
  checkSiteUrl,
  countBySeverity,
  dedupePages,
  extractPageFacts,
  internalLinksFrom,
  rankFindings,
} from '../lib/site-audit.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log('checkSiteUrl — the server fetches whatever this allows');

check('an ordinary domain is accepted and normalised', () => {
  const result = checkSiteUrl('adgrowly.ca');
  assert.equal(result.ok, true);
  assert.equal(result.origin, 'https://adgrowly.ca');
  assert.equal(result.host, 'adgrowly.ca');
});

check('an explicit scheme is respected', () => {
  assert.equal(checkSiteUrl('http://example.com').origin, 'http://example.com');
  assert.equal(
    checkSiteUrl('https://example.com/pricing').origin,
    'https://example.com',
  );
});

check('loopback and metadata addresses are refused', () => {
  // This endpoint fetches a customer-supplied URL from inside the platform,
  // which is a server-side request forgery primitive unless fenced. 169.254.
  // 169.254 hands out cloud credentials on several providers.
  for (const host of [
    'localhost',
    '127.0.0.1',
    'http://127.0.0.1:8787',
    '169.254.169.254',
    'http://metadata.google.internal',
    '0.0.0.0',
    '[::1]',
  ])
    assert.equal(checkSiteUrl(host).ok, false, host);
});

check('private network ranges are refused', () => {
  for (const host of [
    '10.0.0.5',
    '192.168.1.1',
    '172.16.0.9',
    '172.31.255.254',
    'http://10.1.2.3:3000/admin',
  ])
    assert.equal(checkSiteUrl(host).ok, false, host);
});

check('a public address in a nearby range is still allowed', () => {
  // 172.32 is outside the private block; refusing it would be a false positive.
  assert.equal(checkSiteUrl('172.32.0.1').ok, true);
  assert.equal(checkSiteUrl('8.8.8.8').ok, true);
});

check('a non-http scheme cannot be smuggled in', () => {
  for (const value of [
    'file:///etc/passwd',
    'ftp://example.com',
    'javascript:alert(1)',
    'gopher://example.com',
  ])
    assert.equal(checkSiteUrl(value).ok, false, value);
});

check('a bare hostname with no dot is refused', () => {
  // That is a machine on the local network, not a website.
  assert.equal(checkSiteUrl('intranet').ok, false);
  assert.equal(checkSiteUrl('http://router/').ok, false);
});

check('empty and malformed input is refused with a reason', () => {
  for (const value of ['', '   ', 'not a url at all ///']) {
    const result = checkSiteUrl(value);
    assert.equal(result.ok, false, value);
    assert.ok(result.reason.length > 5);
  }
});

console.log('extractPageFacts');

const html = `<!doctype html><html><head>
  <title>Google Business Profile management software</title>
  <meta name="description" content="Manage every location from one place, with approvals and exports built in for agencies and multi-location brands.">
</head><body>
  <h1>Google Business Profile management software</h1>
  <h2>Built for agencies</h2>
  <a href="/pricing">Pricing</a>
  <a href="/features">Features</a>
  <a href="https://twitter.com/x">Twitter</a>
  <a href="/contact">Book a demo</a>
  <button>Start free trial</button>
  <form action="/signup"></form>
  <script>var ignored = "not content";</script>
  <p>${'word '.repeat(300)}</p>
</body></html>`;

check('the fields a finding cites are read correctly', () => {
  const facts = extractPageFacts({
    url: 'https://adgrowly.ca/',
    status: 200,
    html,
  });
  assert.equal(facts.path, '/');
  assert.match(facts.title, /Google Business Profile/);
  assert.ok(facts.metaDescription.length > 70);
  assert.deepEqual(facts.h1, ['Google Business Profile management software']);
  assert.deepEqual(facts.h2, ['Built for agencies']);
  assert.equal(facts.hasForm, true);
});

check('script and style text is not counted as page content', () => {
  const facts = extractPageFacts({ url: 'https://x.co/', status: 200, html });
  assert.ok(facts.wordCount > 250);
  // "not content" lived only inside a <script>.
  assert.ok(facts.wordCount < 400, String(facts.wordCount));
});

check('only same-site links are counted as internal', () => {
  const facts = extractPageFacts({ url: 'https://x.co/', status: 200, html });
  assert.equal(facts.internalLinks, 3);
});

check('calls to action are found in links and buttons', () => {
  const facts = extractPageFacts({ url: 'https://x.co/', status: 200, html });
  assert.ok(facts.ctas.includes('Book a demo'));
  assert.ok(facts.ctas.includes('Start free trial'));
});

check('a page with nothing in it does not throw', () => {
  const facts = extractPageFacts({
    url: 'https://x.co/',
    status: 200,
    html: '',
  });
  assert.equal(facts.title, '');
  assert.equal(facts.wordCount, 0);
  assert.deepEqual(facts.h1, []);
});

console.log('internalLinksFrom');

check('outbound links are never followed', () => {
  // Following them would crawl the internet on the customer's behalf.
  const links = internalLinksFrom(html, 'https://adgrowly.ca');
  assert.ok(links.every((l) => l.startsWith('https://adgrowly.ca')));
  assert.ok(!links.some((l) => l.includes('twitter')));
});

check('assets are skipped', () => {
  const links = internalLinksFrom(
    '<a href="/a.png">x</a><a href="/style.css">y</a><a href="/real">z</a>',
    'https://x.co',
  );
  assert.deepEqual(links, ['https://x.co/real']);
});

check('anchors, mailto and tel are skipped', () => {
  const links = internalLinksFrom(
    '<a href="#top">a</a><a href="mailto:x@y.z">b</a><a href="tel:+91">c</a>',
    'https://x.co',
  );
  assert.deepEqual(links, []);
});

console.log('auditPage — every finding must cite its own number');

const facts = (over = {}) => ({
  url: 'https://x.co/',
  path: '/',
  status: 200,
  title: 'A perfectly reasonable page title for ranking',
  metaDescription: 'x'.repeat(140),
  h1: ['One heading'],
  h2: [],
  wordCount: 800,
  internalLinks: 10,
  ctas: ['Book a demo'],
  hasForm: false,
  clientRendered: false,
  bytes: 1000,
  ...over,
});

check('a healthy page produces no findings', () => {
  assert.deepEqual(auditPage(facts()), []);
});

check('a missing title is high severity and says so', () => {
  const [finding] = auditPage(facts({ title: '' }));
  assert.equal(finding.severity, 'high');
  assert.equal(finding.area, 'seo');
  assert.match(finding.evidence, /No <title>/);
  assert.ok(finding.doThis.length > 20);
});

check('a short title quotes its length and its text', () => {
  const [finding] = auditPage(facts({ title: 'Home' }));
  assert.match(finding.evidence, /4 characters/);
  assert.match(finding.evidence, /Home/);
});

check('a page with no action at all is high severity', () => {
  // A page with no action collects no leads however much traffic reaches it.
  const [finding] = auditPage(facts({ ctas: [], hasForm: false }));
  assert.equal(finding.area, 'conversion');
  assert.equal(finding.severity, 'high');
});

check('a form counts as an action even with no CTA link', () => {
  assert.deepEqual(auditPage(facts({ ctas: [], hasForm: true })), []);
});

check('thin content scales with how thin it is', () => {
  assert.equal(auditPage(facts({ wordCount: 200 }))[0].severity, 'medium');
  assert.equal(auditPage(facts({ wordCount: 40 }))[0].severity, 'high');
  // A page that could not be read at all is not called thin.
  assert.deepEqual(auditPage(facts({ wordCount: 0 })), []);
});

check('several H1s are reported with the headings themselves', () => {
  const [finding] = auditPage(facts({ h1: ['One', 'Two', 'Three'] }));
  assert.match(finding.evidence, /“One”/);
  assert.equal(finding.severity, 'low');
});

check('every finding names its page and carries evidence', () => {
  const all = auditPage(
    facts({
      path: '/pricing',
      title: '',
      metaDescription: '',
      h1: [],
      ctas: [],
      wordCount: 50,
    }),
  );
  assert.ok(all.length >= 4);
  for (const finding of all) {
    assert.equal(finding.page, '/pricing');
    assert.ok(finding.evidence.length > 5, finding.id);
    assert.ok(finding.doThis.length > 10, finding.id);
    assert.ok(finding.why.length > 10, finding.id);
  }
});

console.log('client-rendered pages');

check('a JavaScript app shell is detected rather than called thin', () => {
  const html =
    '<html><head><title>Contact Sales | Example</title></head><body>' +
    '<div>Loading</div>' +
    '<script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script>' +
    '</body></html>';
  const page = extractPageFacts({
    url: 'https://x.co/contact',
    status: 200,
    html,
  });
  assert.equal(page.clientRendered, true);
});

check('a genuinely short static page is not mistaken for one', () => {
  const html =
    '<html><head><title>Hi</title></head><body><p>Short page.</p></body></html>';
  const page = extractPageFacts({ url: 'https://x.co/', status: 200, html });
  assert.equal(page.clientRendered, false);
});

check('the finding says what is actually wrong', () => {
  // Telling somebody to "add more copy" to a page that already has plenty is
  // advice that destroys trust in the rest of the report.
  const found = auditPage(facts({ wordCount: 6, clientRendered: true }));
  const rendered = found.find((f) => f.id.endsWith('client-rendered'));
  assert.ok(rendered, JSON.stringify(found.map((f) => f.id)));
  assert.match(rendered.title, /built in the browser/);
  assert.match(rendered.why, /does not run JavaScript/);
  assert.ok(!found.some((f) => f.id.endsWith(':thin')));
});

check('claims the HTML cannot support are not made about such a page', () => {
  // No H1 and no CTA in an app shell says nothing about what the visitor sees.
  const found = auditPage(
    facts({
      wordCount: 6,
      clientRendered: true,
      h1: [],
      ctas: [],
      hasForm: false,
    }),
  );
  assert.ok(!found.some((f) => f.id.endsWith('h1-missing')));
  assert.ok(!found.some((f) => f.id.endsWith('no-cta')));
});

check('a static page still gets those findings', () => {
  const found = auditPage(facts({ h1: [], ctas: [], hasForm: false }));
  assert.ok(found.some((f) => f.id.endsWith('h1-missing')));
  assert.ok(found.some((f) => f.id.endsWith('no-cta')));
});

console.log('dedupePages');

check('a soft-404 site is not audited seven times over', () => {
  // example.com answers every path with the home page; auditing each copy
  // reported the same problem seven times and buried whatever was real.
  const same = (path) =>
    facts({ path, title: 'Example Domain', wordCount: 21 });
  const { pages, duplicates } = dedupePages([
    same('/'),
    same('/pricing'),
    same('/about'),
  ]);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].path, '/');
  assert.deepEqual(duplicates.sort(), ['/about', '/pricing']);
});

check('genuinely different pages are all kept', () => {
  const { pages, duplicates } = dedupePages([
    facts({ path: '/', title: 'Home', wordCount: 900 }),
    facts({ path: '/pricing', title: 'Pricing', wordCount: 300 }),
  ]);
  assert.equal(pages.length, 2);
  assert.deepEqual(duplicates, []);
});

check('the shallower path survives, because that is the canonical one', () => {
  const same = (path) => facts({ path, title: 'Same', wordCount: 100 });
  const { pages } = dedupePages([same('/a/b/c'), same('/a')]);
  assert.equal(pages[0].path, '/a');
});

console.log('ranking');

check('worst first, homepage before deeper pages', () => {
  const ranked = rankFindings([
    {
      id: 'a',
      page: '/pricing',
      severity: 'low',
      title: '',
      doThis: '',
      why: '',
      evidence: '',
      area: 'seo',
    },
    {
      id: 'b',
      page: '/deep',
      severity: 'high',
      title: '',
      doThis: '',
      why: '',
      evidence: '',
      area: 'seo',
    },
    {
      id: 'c',
      page: '/',
      severity: 'high',
      title: '',
      doThis: '',
      why: '',
      evidence: '',
      area: 'seo',
    },
  ]);
  assert.deepEqual(
    ranked.map((f) => f.id),
    ['c', 'b', 'a'],
  );
});

check('counts are per severity', () => {
  const counts = countBySeverity([
    { severity: 'high' },
    { severity: 'high' },
    { severity: 'low' },
  ]);
  assert.deepEqual(counts, { high: 2, medium: 0, low: 1 });
});

console.log(`\n${passed} assertions passed.`);
