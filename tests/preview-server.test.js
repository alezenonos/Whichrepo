import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PREVIEW_PORT,
  compileRules,
  compileSource,
  contentTypeFor,
  headersFor,
  resolveRequest,
} from '../node/preview-server.mjs';

// #85. The preview server is what makes the deployment's own policy observable to a browser, so a
// defect in it is a defect in every assertion that rests on it: a server that silently matched no
// header rule would report a site with no CSP as a site with a CSP, which is the worst possible
// outcome for a test suite whose whole job is checking the policy.
// The rule shapes Whichcar's vercel.json publishes, captured here so the test does not depend on an
// instance: a catch-all, three specific paths and a prefix wildcard.
const config = {
  cleanUrls: true,
  headers: [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
      ],
    },
    { source: '/', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
    { source: '/index.html', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
    { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
  ],
};
const rules = compileRules(config);
const present = new Set([
  '/index.html',
  '/prices.html',
  '/privacy.html',
  '/terms.html',
  '/contact.html',
  '/sw.js',
  '/robots.txt',
  '/assets/app.abcdef12.js',
]);
const exists = (file) => present.has(file);

describe('the preview server applies the deployment’s own header rules', () => {
  it('gives every path the security headers from the catch-all rule', () => {
    const headers = headersFor('/', rules);
    assert.match(headers['Content-Security-Policy'], /^default-src 'self'/);
    assert.equal(headers['X-Frame-Options'], 'DENY');
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  });

  it('lets a specific rule win over the catch-all, the way the host resolves them', () => {
    // Both `/(.*)` and `/assets/(.*)` match a bundle; the second is the one that decides caching,
    // and getting this backwards would let the suite report immutable caching on the HTML.
    assert.equal(headersFor('/assets/app.abcdef12.js', rules)['Cache-Control'], 'public, max-age=31536000, immutable');
    assert.equal(headersFor('/', rules)['Cache-Control'], 'public, max-age=0, must-revalidate');
    assert.equal(headersFor('/sw.js', rules)['Cache-Control'], 'no-store');
    // And the specific rule does not lose the catch-all's headers on the way.
    assert.match(headersFor('/assets/app.abcdef12.js', rules)['Content-Security-Policy'], /script-src 'self'/);
  });

  it('refuses a source pattern it cannot faithfully reproduce', () => {
    // Fail closed. A pattern shape this file does not understand must stop the server rather than
    // match nothing: a rule that quietly stops applying is a policy that quietly stops being
    // tested, which is the defect #85 is about.
    assert.throws(() => compileSource('/(.*)/edge'), /cannot read the header source/);
    assert.throws(() => compileSource('/api/:path*'), /cannot read the header source/);
    assert.throws(() => compileSource('relative'), /cannot read the header source/);
    assert.equal(compileSource('/(.*)')('/anything'), true);
    assert.equal(compileSource('/sw.js')('/sw.js'), true);
    assert.equal(compileSource('/sw.js')('/sw.js.map'), false);
  });

});

describe('the preview server resolves paths the way cleanUrls does', () => {
  it('serves a clean URL from the .html file behind it', () => {
    assert.deepEqual(resolveRequest('/prices', { cleanUrls: true, exists }), { status: 200, file: '/prices.html' });
    assert.deepEqual(resolveRequest('/', { cleanUrls: true, exists }), { status: 200, file: '/index.html' });
  });

  it('redirects the extension to the clean URL, which is the half a naive server skips', () => {
    // Vercel does both, and only doing the first would let a footer link to `/prices.html` pass here
    // and 308 in production -- a difference the suite exists to eliminate rather than introduce.
    assert.deepEqual(resolveRequest('/prices.html', { cleanUrls: true, exists }), { status: 308, location: '/prices' });
    assert.deepEqual(resolveRequest('/index.html', { cleanUrls: true, exists }), { status: 308, location: '/' });
  });

  it('serves the file directly when clean URLs are off', () => {
    assert.deepEqual(resolveRequest('/prices.html', { cleanUrls: false, exists }), { status: 200, file: '/prices.html' });
    assert.deepEqual(resolveRequest('/prices', { cleanUrls: false, exists }), { status: 404 });
  });

  it('404s a path with no file rather than falling back to the index', () => {
    // A single-page-app fallback would make every broken asset path serve the homepage, and the
    // stale-HTML recovery test would then assert against an HTML document pretending to be a script.
    assert.deepEqual(resolveRequest('/assets/app.deadbeef.js', { cleanUrls: true, exists }), { status: 404 });
    assert.deepEqual(resolveRequest('/nothing-here', { cleanUrls: true, exists }), { status: 404 });
  });

  it('refuses a path that climbs out of the served directory', () => {
    assert.equal(resolveRequest('/../vercel.json', { cleanUrls: true, exists }).status, 400);
    assert.equal(resolveRequest('/assets/../../package.json', { cleanUrls: true, exists }).status, 400);
    assert.equal(resolveRequest('/%2e%2e/package.json', { cleanUrls: true, exists }).status, 400);
  });


  it('names a content type for everything the build emits', () => {
    // A stylesheet served as octet-stream is ignored by the browser and the page renders unstyled,
    // which no assertion in the browser suite is looking for.
    assert.equal(contentTypeFor('/assets/app.abcdef12.css'), 'text/css; charset=utf-8');
    assert.equal(contentTypeFor('/assets/app.abcdef12.js'), 'text/javascript; charset=utf-8');
    assert.equal(contentTypeFor('/index.html'), 'text/html; charset=utf-8');
    assert.equal(contentTypeFor('/sitemap.xml'), 'application/xml; charset=utf-8');
    assert.equal(contentTypeFor('/robots.txt'), 'text/plain; charset=utf-8');
    assert.equal(contentTypeFor('/og-image.png'), 'image/png');
  });
});

// #143. A mistyped URL on the deployment gets Vercel's root 404.html with a 404 status. The preview
// answered plain-text "Not found", so the dist suite never saw the page a visitor lands on.
describe('the preview serves the not-found page the way the host does', () => {
  const serve = async (files) => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { createPreviewServer } = await import('../node/preview-server.mjs');
    const root = mkdtempSync(path.join(tmpdir(), 'whichrepo-preview-'));
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(root, name), body);
    const configPath = path.join(root, 'vercel.json');
    writeFileSync(configPath, JSON.stringify({ cleanUrls: true, headers: [] }));
    const server = await createPreviewServer({ root, configPath });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { server, base: `http://127.0.0.1:${server.address().port}` };
  };

  it('answers an unknown path with 404.html and a 404 status', async () => {
    const { server, base } = await serve({ 'index.html': 'home', '404.html': '<h1>Page not found</h1>' });
    try {
      const response = await fetch(`${base}/no-such-page`);
      assert.equal(response.status, 404);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.match(await response.text(), /Page not found/);
    } finally {
      server.close();
    }
  });

  it('falls back to plain text for an artifact with no 404.html', async () => {
    const { server, base } = await serve({ 'index.html': 'home' });
    try {
      const response = await fetch(`${base}/no-such-page`);
      assert.equal(response.status, 404);
      assert.equal(await response.text(), 'Not found');
    } finally {
      server.close();
    }
  });
});
