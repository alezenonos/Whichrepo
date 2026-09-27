// Reads an instance's `which.config.mjs`: the one file that says what the site is called, which
// environment prefix it reads, and where its generated files live. Every CLI in `bin/` reads it, so
// an instance's package.json scripts are one-liners and nothing in this package names a site.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONFIG_FILE = 'which.config.mjs';

export const DEFAULTS = Object.freeze({
  paths: Object.freeze({
    public: 'public',
    dist: 'dist',
    vendor: 'public/src/whichrepo',
    badge: 'docs/coverage.svg',
    hostConfig: 'vercel.json',
  }),
  preview: Object.freeze({ port: 4174 }),
  coverageExclusions: Object.freeze(['tests/**', 'dist/**']),
});

export function normaliseConfig(raw = {}) {
  if (!raw.name) throw new Error(`${CONFIG_FILE} must export a \`name\` (the site's brand, e.g. "WhichCar")`);
  const slug = raw.slug ?? String(raw.name).toLowerCase();
  return {
    ...raw,
    slug,
    envPrefix: raw.envPrefix ?? slug.toUpperCase(),
    paths: { ...DEFAULTS.paths, ...(raw.paths ?? {}) },
    preview: { ...DEFAULTS.preview, ...(raw.preview ?? {}) },
    coverageExclusions: raw.coverageExclusions ?? [
      ...DEFAULTS.coverageExclusions,
      `${raw.paths?.vendor ?? DEFAULTS.paths.vendor}/**`,
    ],
  };
}

export async function loadConfig(root = process.cwd()) {
  const file = path.join(root, CONFIG_FILE);
  if (!existsSync(file))
    throw new Error(`No ${CONFIG_FILE} in ${root}. See docs/new-instance.md in the whichrepo package.`);
  const module = await import(pathToFileURL(file).href);
  return normaliseConfig(module.default ?? module);
}
