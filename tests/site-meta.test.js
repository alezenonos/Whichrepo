import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, canonicalUrl, createSiteMeta, factsIn, normaliseOrigin, placeholderOriginFor, substituteFacts } from '../node/site-meta.mjs';

const pages = [
  { slug: '', file: 'index.html', title: 'WhichPhone – Compare phones by price and priorities', description: 'Compare phones on price and what matters to you.', priority: '1.0' },
  { slug: 'prices', file: 'prices.html', title: 'How prices work – WhichPhone', description: 'Where every price comes from.', priority: '0.7' },
  { slug: 'privacy', file: 'privacy.html', title: 'Privacy – WhichPhone', description: 'What is stored on your device.', priority: '0.3' },
];
const site = createSiteMeta({ name: 'WhichPhone', pages, ogImage: { alt: 'WhichPhone — phones plotted by price against match score' } });
const { PAGES, PLACEHOLDER_ORIGIN, isPlaceholderOrigin, renderHeadTags, renderRobots, renderSitemap, resolveOrigin } = site;

describe('createSiteMeta derives what it can from the name', () => {
  it('names the origin variable, the slug and the placeholder from the brand', () => {
    assert.equal(site.slug, 'whichphone');
    assert.equal(site.originVariable, 'WHICHPHONE_SITE_ORIGIN');
    assert.equal(PLACEHOLDER_ORIGIN, 'https://whichphone.invalid');
    assert.equal(placeholderOriginFor('whichcar'), 'https://whichcar.invalid');
  });
  it('refuses to describe a site with no name', () => assert.throws(() => createSiteMeta({}), /needs the site name/));
});

// The origin need not be decided, and this exists so that not deciding costs nothing: Vercel
// publishes the deployment's hostname to the build environment, so the canonical URL is right on
// the real host without configuration, and a custom domain later is one variable.
describe('resolveOrigin', () => {
  it('prefers an explicit origin over anything the host infers', () => {
    assert.equal(resolveOrigin({ WHICHPHONE_SITE_ORIGIN: 'https://whichphone.example', VERCEL_URL: 'x.vercel.app' }), 'https://whichphone.example');
  });
  // The per-deployment hostname changes on every push. A canonical URL that changes on every push
  // tells a search engine the page moved, every time, which is worse than having no canonical tag.
  it('prefers the stable production hostname over the per-deployment one', () => {
    assert.equal(resolveOrigin({ VERCEL_PROJECT_PRODUCTION_URL: 'whichphone.vercel.app', VERCEL_URL: 'whichphone-9fx2.vercel.app' }), 'https://whichphone.vercel.app');
  });
  it('adds the scheme Vercel omits and strips a trailing slash', () => {
    assert.equal(resolveOrigin({ VERCEL_URL: 'whichphone.vercel.app' }), 'https://whichphone.vercel.app');
    assert.equal(normaliseOrigin('https://whichphone.example/'), 'https://whichphone.example');
    assert.equal(normaliseOrigin('http://localhost:4173'), 'http://localhost:4173');
  });
  // `.invalid` is reserved by RFC 2606 and can never resolve. A plausible placeholder is the
  // dangerous kind: it sits in a canonical tag looking entirely correct while pointing search engines
  // at a domain somebody else owns.
  it('falls back to a placeholder that cannot resolve, and says so', () => {
    assert.equal(resolveOrigin({}), PLACEHOLDER_ORIGIN);
    assert.match(PLACEHOLDER_ORIGIN, /\.invalid$/);
    assert.equal(isPlaceholderOrigin(PLACEHOLDER_ORIGIN), true);
    assert.equal(isPlaceholderOrigin('https://whichphone.example'), false);
  });
  it('reads another instance\'s variable under its own prefix', () => {
    const car = createSiteMeta({ name: 'WhichCar', pages });
    assert.equal(car.resolveOrigin({ WHICHCAR_SITE_ORIGIN: 'https://whichcar.com.cy', WHICHPHONE_SITE_ORIGIN: 'https://wrong.example' }), 'https://whichcar.com.cy');
  });
});

describe('canonical URLs', () => {
  it('gives the homepage a trailing slash and every other page none', () => {
    assert.equal(canonicalUrl('https://whichphone.example', ''), 'https://whichphone.example/');
    assert.equal(canonicalUrl('https://whichphone.example', 'privacy'), 'https://whichphone.example/privacy');
  });
});

describe('renderHeadTags', () => {
  const origin = 'https://whichphone.example';
  const page = PAGES.find((entry) => entry.slug === 'prices');
  it('gives a page its canonical URL, its own title, the site name and an absolute image', () => {
    const tags = renderHeadTags(origin, page);
    assert.ok(tags.includes('<link rel="canonical" href="https://whichphone.example/prices"/>'));
    assert.ok(tags.includes('<meta property="og:url" content="https://whichphone.example/prices"/>'));
    assert.ok(tags.includes('<meta property="og:site_name" content="WhichPhone"/>'));
    assert.ok(tags.includes('content="https://whichphone.example/og-image.png"'));
    assert.ok(tags.includes('summary_large_image'));
  });
  // A relative og:image is the classic way a preview silently fails: the scraper, which has no page
  // context, resolves it against nothing and shows no image at all.
  it('never emits a relative image URL', () => {
    for (const entry of PAGES) assert.match(/property="og:image" content="([^"]+)"/.exec(renderHeadTags(origin, entry))[1], /^https:\/\//);
  });
  it('describes the image rather than leaving it unlabelled, and states its dimensions', () => {
    const tags = renderHeadTags(origin, page);
    assert.match(tags, /og:image:alt" content="WhichPhone — phones plotted/);
    assert.ok(tags.includes(`<meta property="og:image:width" content="${OG_IMAGE_WIDTH}"/>`));
    assert.ok(tags.includes(`<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}"/>`));
  });
  it('puts structured data on the homepage alone, describing a free application and not an offer', () => {
    const home = renderHeadTags(origin, PAGES[0]);
    assert.match(home, /application\/ld\+json/);
    assert.match(home, /"@type":"WebApplication"/);
    assert.doesNotMatch(home, /Offer|Product/);
    assert.doesNotMatch(renderHeadTags(origin, page), /application\/ld\+json/);
  });
  it('lets an instance replace or drop the structured data', () => {
    const custom = createSiteMeta({ name: 'WhichPhone', pages, jsonLd: (o) => ({ '@type': 'Thing', url: o }) });
    assert.match(custom.renderHeadTags(origin, PAGES[0]), /"@type":"Thing"/);
    const none = createSiteMeta({ name: 'WhichPhone', pages, jsonLd: null });
    assert.doesNotMatch(none.renderHeadTags(origin, PAGES[0]), /ld\+json/);
  });
  it('escapes a quote in a title rather than breaking out of the attribute', () => {
    const tags = renderHeadTags(origin, { slug: 'x', title: 'A "quoted" title', description: 'd' });
    assert.ok(tags.includes('A &quot;quoted&quot; title'));
    assert.ok(!tags.includes('content="A "quoted'));
  });
});

describe('robots.txt', () => {
  it('advertises the sitemap once there is a real origin to advertise', () => {
    assert.match(renderRobots('https://whichphone.example'), /^Sitemap: https:\/\/whichphone\.example\/sitemap\.xml$/m);
  });
  // A sitemap line pointing at a hostname the site is not served from is a confident instruction to
  // go and fetch nothing.
  it('advertises no sitemap at all from the placeholder origin', () => {
    assert.doesNotMatch(renderRobots(PLACEHOLDER_ORIGIN), /Sitemap:/);
    assert.match(renderRobots(PLACEHOLDER_ORIGIN), /^Allow: \/$/m);
  });
});

describe('sitemap.xml', () => {
  it('lists every page exactly once, at its canonical URL', () => {
    const xml = renderSitemap('https://whichphone.example', '2026-08-24');
    const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    assert.equal(locations.length, PAGES.length);
    assert.equal(new Set(locations).size, PAGES.length);
    for (const page of PAGES) assert.ok(locations.includes(canonicalUrl('https://whichphone.example', page.slug)));
  });
  // #142. A build once fell back to today's date whenever git failed, stamping every URL with every
  // deploy's date. A date is per page, and an unknown one omits the tag instead of inventing it.
  it('dates each page separately, and omits the tag for a page it cannot date', () => {
    const xml = renderSitemap('https://whichphone.example', (page) => (page.slug === 'privacy' ? '2026-08-01' : null));
    assert.equal((xml.match(/<lastmod>/g) ?? []).length, 1);
    assert.match(xml, /<loc>https:\/\/whichphone\.example\/privacy<\/loc>\n    <lastmod>2026-08-01<\/lastmod>/);
    assert.doesNotMatch(renderSitemap('https://whichphone.example', null), /<lastmod>/);
  });
  it('is well-formed enough to declare its namespace and close its tags', () => {
    const xml = renderSitemap('https://whichphone.example', '2026-08-24');
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
    assert.equal((xml.match(/<url>/g) ?? []).length, (xml.match(/<\/url>/g) ?? []).length);
  });
});

// #131. A page that states a number about the catalogue has to compute it from the records rather
// than assert it, or the page and the data drift by one, as three of them did.
describe('facts written into a page at build time', () => {
  it('replaces every data-fact span, whitespace-tolerant, and reports which it replaced', () => {
    const html = '<p><span data-fact="priced">0</span> of <span\n  data-fact="total"\n>0</span></p>';
    const out = substituteFacts(html, { priced: '122', total: '127' });
    assert.equal(out.html, '<p><span data-fact="priced">122</span> of <span\n  data-fact="total"\n>127</span></p>');
    assert.deepEqual(out.facts, ['priced', 'total']);
  });
  // The alternative is a page that keeps its fallback text and looks entirely correct.
  it('fails on a fact it does not know or cannot value, rather than keeping the fallback', () => {
    assert.throws(() => substituteFacts('<span data-fact="nope">1</span>', {}), /no value for data-fact="nope"/);
    assert.throws(() => substituteFacts('<span data-fact="x">1</span>', { x: null }), /no value/);
  });
  it('reads the fallback text a source page carries, for the test that holds it to the data', () => {
    assert.deepEqual(factsIn('<span data-fact="priced">122</span> and <span data-fact="total">127</span>'), { priced: '122', total: '127' });
  });
});
