// Serves `dist/` the way the deployment serves it, so the browser suite can run against the
// artifact that actually ships. #85.
//
// The browser job tested `public/` through `python3 -m http.server`: unbundled ES modules, no CSP,
// no cache headers and no clean URLs. Everything the deployment adds -- the bundler's regex rewrite
// of module syntax, a strict `script-src` that allows exactly one inline script by hash, immutable
// asset caching, and `/prices` resolving to `prices.html` -- was therefore exercised by nothing that
// runs a browser. Two of those have already broken the site once each: a wrapped import list that
// survived into the bundle, and a stylesheet rewrite that matched nothing.
//
// **Every rule here is read from `vercel.json`, never copied from it.** A second hand-maintained
// copy of the deployment's headers would drift, and a test against a drifted copy is worse than no
// test: it reports the policy it invented rather than the policy that ships.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

// One port, named once. An instance's `playwright.config.js` imports it for the base URL and its npm
// script bakes the same origin into the preview build, because the smoke suite asserts that canonical
// URLs name the host actually serving the page -- so a port that drifts between the two turns a real
// check into a confusing failure. A test in the instance pins the npm script to this constant.
export const PREVIEW_PORT = 4174;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export function contentTypeFor(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

// Vercel's `source` is a path pattern, not a regular expression. Only the shapes this file's own
// config uses are understood -- a literal path, and a literal prefix followed by `(.*)` -- and
// anything else throws rather than being quietly treated as "matches nothing". A header rule that
// silently stops matching is exactly the failure this server exists to catch, so it may not be the
// failure the server itself has.
export function compileSource(source) {
  if (typeof source !== 'string' || !source.startsWith('/'))
    throw new Error(`preview-server cannot read the header source ${JSON.stringify(source)}`);
  const wildcard = source.indexOf('(.*)');
  if (wildcard === -1) {
    if (/[()*?[\]{}+]/.test(source))
      throw new Error(`preview-server cannot read the header source ${JSON.stringify(source)}`);
    return (pathname) => pathname === source;
  }
  if (wildcard !== source.length - 4)
    throw new Error(`preview-server cannot read the header source ${JSON.stringify(source)}`);
  const prefix = source.slice(0, wildcard);
  if (/[()*?[\]{}+]/.test(prefix))
    throw new Error(`preview-server cannot read the header source ${JSON.stringify(source)}`);
  return (pathname) => pathname.startsWith(prefix);
}

export function compileRules(config) {
  return (config?.headers ?? []).map((rule) => ({
    matches: compileSource(rule.source),
    headers: rule.headers ?? [],
  }));
}

// Later rules win, which is how Vercel resolves overlapping sources: the catch-all `/(.*)` sets the
// security headers and the specific `/assets/(.*)` rule then sets Cache-Control on top of them.
export function headersFor(pathname, rules) {
  const out = {};
  for (const rule of rules) {
    if (!rule.matches(pathname)) continue;
    for (const header of rule.headers) out[header.key] = header.value;
  }
  return out;
}

// `cleanUrls: true` does two things, and a server that does only the first passes tests the real
// host would fail: `/prices` serves `prices.html`, and `/prices.html` redirects to `/prices`. The
// redirect is why the footer may not link to the extension, and why a link that does still works.
export function resolveRequest(pathname, { cleanUrls = false, exists } = {}) {
  const decoded = decodeURIComponent(pathname);
  // A path that climbs out of the served directory is refused rather than normalised into
  // something servable. This server only ever faces a test runner, but a directory traversal that
  // works locally is a habit that ships.
  if (decoded.includes('\0') || decoded.split('/').includes('..')) return { status: 400 };
  if (decoded.endsWith('/')) {
    const index = `${decoded}index.html`;
    return exists(index) ? { status: 200, file: index } : { status: 404 };
  }
  if (cleanUrls && decoded.endsWith('.html')) {
    const clean = decoded.slice(0, -'.html'.length);
    if (exists(decoded)) return { status: 308, location: clean === '/index' ? '/' : clean };
  }
  if (exists(decoded)) return { status: 200, file: decoded };
  if (cleanUrls && exists(`${decoded}.html`)) return { status: 200, file: `${decoded}.html` };
  return { status: 404 };
}

export async function createPreviewServer({ root, configPath }) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const rules = compileRules(config);
  const cleanUrls = Boolean(config.cleanUrls);
  const exists = (file) => {
    const target = path.join(root, file);
    return target.startsWith(root) && existsSync(target) && statSync(target).isFile();
  };
  return http.createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://127.0.0.1');
    const resolved = resolveRequest(pathname, { cleanUrls, exists });
    // The headers are applied to the path that was *asked for*, which is what the deployment does:
    // a request for `/prices` carries the catch-all rule's CSP whether or not the file behind it is
    // called prices.html.
    const headers = headersFor(pathname, rules);
    if (resolved.status === 308) {
      response.writeHead(308, { ...headers, Location: resolved.location });
      response.end();
      return;
    }
    // #143. What Vercel does for a static deployment: a path that matches nothing gets the root
    // 404.html, with a 404 status. The plain-text answer this used to give meant the dist suite never
    // saw what a visitor who mistypes a URL sees.
    if (resolved.status === 404 && exists('/404.html')) {
      response.writeHead(404, { ...headers, 'Content-Type': contentTypeFor('/404.html') });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      createReadStream(path.join(root, '404.html')).pipe(response);
      return;
    }
    if (resolved.status !== 200) {
      response.writeHead(resolved.status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(resolved.status === 404 ? 'Not found' : 'Bad request');
      return;
    }
    response.writeHead(200, { ...headers, 'Content-Type': contentTypeFor(resolved.file) });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(path.join(root, resolved.file)).pipe(response);
  });
}

// What an instance's `scripts/preview-server.mjs` (or `which-preview`) runs at the top level. `root`
// is the built artifact and `configPath` the host configuration the headers are read from;
// `originVariable` is only named in the help text and the refusal, so the operator is told the
// variable *their* build reads (`WHICHCAR_SITE_ORIGIN`), not a generic one.
export async function previewMain({
  argv = process.argv.slice(2),
  root,
  configPath,
  defaultPort = PREVIEW_PORT,
  originVariable = 'WHICH_SITE_ORIGIN',
  buildCommand = 'npm run preview:build',
  log = console.log,
  error = console.error,
  exit = (code) => process.exit(code),
} = {}) {
  if (argv.includes('--help')) {
    log(`Usage: preview-server [--port=${defaultPort}]

Serves the built artifact with the headers, cleanUrls and 404 handling read out of the host
configuration. Build it first for this origin: ${buildCommand} (or ${originVariable}=http://127.0.0.1:<port>
followed by the build).`);
    return exit(0);
  }
  const port = Number(argv.find((arg) => arg.startsWith('--port='))?.slice('--port='.length) ?? defaultPort);
  const index = path.join(root, 'index.html');
  if (!existsSync(index)) {
    error(`${index} is missing. Run \`${buildCommand}\` before serving the preview.`);
    return exit(1);
  }
  // The artifact has to have been built *for this server*. A build carries its origin in the
  // canonical tag, the sitemap and robots.txt, so serving a production-origin build here fails four
  // smoke assertions with messages about canonical URLs -- true, and nothing to do with the change
  // under test. Caught here instead, where the fix is one command.
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(readFileSync(index, 'utf8'))?.[1];
  const expected = `http://127.0.0.1:${port}/`;
  if (canonical && canonical !== expected) {
    error(
      `${root} was built for ${canonical}, not ${expected}. Run \`${buildCommand}\` so the artifact and the server agree.`,
    );
    return exit(1);
  }
  const server = await createPreviewServer({ root, configPath });
  server.listen(port, '127.0.0.1', () => {
    log(
      `Preview server on http://127.0.0.1:${port} serving ${root} with ${path.basename(configPath)} headers`,
    );
  });
  return server;
}
