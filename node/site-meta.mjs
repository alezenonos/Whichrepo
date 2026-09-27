// Everything a site needs to say about where it lives: canonical URLs, social previews, robots.txt
// and sitemap.xml. Pure functions, so what a build writes is testable without running a build.
//
// An instance's origin need not be decided, and this is written so that not deciding costs nothing.
// Vercel publishes the deployment's own hostname to the build environment, so on the real host the
// canonical URL is correct without anybody configuring anything; a custom domain later is one
// environment variable. The placeholder is only reached when the build runs somewhere that tells it
// nothing, and `isPlaceholderOrigin` exists so a test can say so out loud rather than let a
// made-up hostname ship quietly in a canonical tag.

// `.invalid` is reserved by RFC 2606 and can never resolve. A plausible-looking placeholder is the
// dangerous kind: it would sit in a canonical tag and a sitemap looking entirely correct, pointing
// search engines at somebody else's domain. This one is wrong in a way that cannot be missed.
export const placeholderOriginFor = (slug) => `https://${slug}.invalid`;

export function normaliseOrigin(value) {
  const withScheme = /^https?:\/\//.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, '');
}

export const canonicalUrl = (origin, slug) => (slug ? `${origin}/${slug}` : `${origin}/`);

export const escapeAttribute = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

// Everything that names the site is configuration, given once:
//
//   name            the brand as it appears in titles and `og:site_name` ("WhichCar")
//   slug            the lower-case name, used for the placeholder origin (`https://whichcar.invalid`)
//   originVariable  the environment variable an explicit origin is read from (`WHICHCAR_SITE_ORIGIN`)
//   locale          `og:locale` ("en_GB")
//   pages           one entry per page: slug, file, title, description, priority, sources
//   ogImage         { path, width, height, alt } for the social preview
//   jsonLd          optional: a function of the origin returning the structured data for the homepage,
//                   or null for none. The default describes a free WebApplication and nothing more: it
//                   is deliberately NOT a Product or Offer, because marking the compared items up as
//                   offers would push figures into shopping surfaces as prices you could pay, which is
//                   the precise claim the disclaimer under the chart exists to refuse.
export function createSiteMeta({
  name,
  slug = String(name ?? 'which').toLowerCase(),
  originVariable = `${slug.toUpperCase()}_SITE_ORIGIN`,
  locale = 'en_GB',
  pages = [],
  ogImage = {},
  jsonLd: jsonLdFor,
} = {}) {
  if (!name) throw new Error('createSiteMeta needs the site name');
  const PLACEHOLDER_ORIGIN = placeholderOriginFor(slug);
  const image = {
    path: ogImage.path ?? '/og-image.png',
    width: ogImage.width ?? OG_IMAGE_WIDTH,
    height: ogImage.height ?? OG_IMAGE_HEIGHT,
    alt: ogImage.alt ?? `${name} — items plotted by price against match score`,
  };
  const PAGES = pages;

  function resolveOrigin(env = {}) {
    const explicit = env[originVariable];
    if (explicit) return normaliseOrigin(explicit);
    // Vercel's production hostname first: VERCEL_URL is the per-deployment hostname and changes on
    // every push, which is exactly what a canonical URL must not do.
    const vercel = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
    if (vercel) return normaliseOrigin(vercel);
    return PLACEHOLDER_ORIGIN;
  }

  const isPlaceholderOrigin = (origin) => origin === PLACEHOLDER_ORIGIN;

  const jsonLd =
    jsonLdFor === null
      ? () => null
      : (jsonLdFor ??
        ((origin) => ({
          '@context': 'https://schema.org',
          '@type': 'WebApplication',
          name,
          url: `${origin}/`,
          applicationCategory: 'BrowserApplication',
          operatingSystem: 'Any',
          browserRequirements: 'Requires JavaScript',
          description: PAGES[0]?.description ?? '',
          isAccessibleForFree: true,
        })));

  function renderHeadTags(origin, page) {
    const url = canonicalUrl(origin, page.slug);
    const imageUrl = `${origin}${image.path}`;
    const tags = [
      `<link rel="canonical" href="${escapeAttribute(url)}"/>`,
      `<meta property="og:type" content="website"/>`,
      `<meta property="og:site_name" content="${escapeAttribute(name)}"/>`,
      `<meta property="og:locale" content="${escapeAttribute(locale)}"/>`,
      `<meta property="og:url" content="${escapeAttribute(url)}"/>`,
      `<meta property="og:title" content="${escapeAttribute(page.title)}"/>`,
      `<meta property="og:description" content="${escapeAttribute(page.description)}"/>`,
      `<meta property="og:image" content="${escapeAttribute(imageUrl)}"/>`,
      `<meta property="og:image:width" content="${image.width}"/>`,
      `<meta property="og:image:height" content="${image.height}"/>`,
      // The alt text is not decoration: a link previewed in a screen reader reads this and nothing
      // else, and "image" is what it says when the tag is missing.
      `<meta property="og:image:alt" content="${escapeAttribute(image.alt)}"/>`,
      `<meta name="twitter:card" content="summary_large_image"/>`,
      `<meta name="twitter:title" content="${escapeAttribute(page.title)}"/>`,
      `<meta name="twitter:description" content="${escapeAttribute(page.description)}"/>`,
      `<meta name="twitter:image" content="${escapeAttribute(imageUrl)}"/>`,
    ];
    if (page.slug === '') {
      const data = jsonLd(origin);
      if (data) tags.push(`<script type="application/ld+json">${JSON.stringify(data)}</script>`);
    }
    return tags.join('');
  }

  // A sitemap pointing at a hostname the site is not served from is worse than no sitemap, so the
  // placeholder origin produces a robots.txt with no Sitemap line rather than a confident wrong one.
  function renderRobots(origin) {
    const lines = ['User-agent: *', 'Allow: /', ''];
    if (!isPlaceholderOrigin(origin)) lines.push(`Sitemap: ${origin}/sitemap.xml`, '');
    return lines.join('\n');
  }

  // `lastmod` is a date, a function of the page returning one, or null. #142: a null date omits the
  // tag. The build used to fall back to today's date whenever git was unavailable, which stamped every
  // URL with every deploy's date -- the thing the date exists not to say. The protocol makes the tag
  // optional, and an absent date is honest where an invented one is not.
  function renderSitemap(origin, lastmod, sitemapPages = PAGES) {
    const dateFor = typeof lastmod === 'function' ? lastmod : () => lastmod;
    const entries = sitemapPages
      .map((page) => {
        const date = dateFor(page);
        return [
          '  <url>',
          `    <loc>${canonicalUrl(origin, page.slug)}</loc>`,
          ...(date ? [`    <lastmod>${date}</lastmod>`] : []),
          `    <priority>${page.priority}</priority>`,
          '  </url>',
        ].join('\n');
      })
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
  }

  return {
    name,
    slug,
    originVariable,
    locale,
    PLACEHOLDER_ORIGIN,
    PAGES,
    OG_IMAGE_PATH: image.path,
    OG_IMAGE_WIDTH: image.width,
    OG_IMAGE_HEIGHT: image.height,
    OG_IMAGE_ALT: image.alt,
    resolveOrigin,
    isPlaceholderOrigin,
    canonicalUrl,
    jsonLd,
    renderHeadTags,
    renderRobots,
    renderSitemap,
  };
}

// #131. A page that states a number about the catalogue ("123 of the items carry a price") has to
// compute it from the records rather than assert it, or the page and the data drift by one, as
// three of them did. `substituteFacts` writes computed facts into `<span data-fact="…">` at build time,
// and `factsIn` reads the fallback text the source page carries so a test can hold it to the same
// values -- so the development server reads right too and a stale figure is a red build rather than a
// quiet lie. What the facts *are* is the instance's business.
// Every `data-fact` span in the page, replaced with the value of that fact. A span naming a fact
// this does not know, or one whose value is unknown, fails the build: the alternative is a page
// that keeps its fallback text and looks entirely correct. Whitespace-tolerant, because Prettier
// wraps a long span across lines and a pattern needing the attribute beside the tag matched nothing.
export function substituteFacts(html, facts) {
  const seen = [];
  const out = html.replace(
    /(<span\s+data-fact="([^"]+)"\s*>)([^<]*)(<\/span\s*>)/g,
    (match, open, key, text, close) => {
      const value = facts[key];
      if (value === null || value === undefined) throw new Error(`no value for data-fact="${key}"`);
      seen.push(key);
      return `${open}${value}${close}`;
    },
  );
  return { html: out, facts: seen };
}

// The fallback text the source page carries for each fact, for the test that holds the source to
// the data it describes.
export function factsIn(html) {
  return Object.fromEntries(
    [...html.matchAll(/<span\s+data-fact="([^"]+)"\s*>([^<]*)<\/span\s*>/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
}
