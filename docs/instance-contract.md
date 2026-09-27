# What an instance provides

An instance is a repository that depends on this package and supplies the parts that are about its
own kind of thing. This page is the contract: what the package expects to find, and what it gives
back.

## 1. `which.config.mjs`

At the instance root, read by every CLI in `bin/`:

```js
export default {
  name: 'WhichPhone', // the brand, as it appears in titles
  // slug: 'whichphone',          derived: lower-case name; the placeholder origin is https://<slug>.invalid
  // envPrefix: 'WHICHPHONE',     derived: upper-case slug; WHICHPHONE_SITE_ORIGIN, WHICHPHONE_RELEASE, ...
  paths: {
    public: 'public',
    dist: 'dist',
    vendor: 'public/src/whichrepo', // where `which-vendor` copies browser/
    badge: 'docs/coverage.svg',
    hostConfig: 'vercel.json',
  },
  preview: { port: 4174 },
  // coverageExclusions: derived: tests/**, dist/**, <vendor>/** — add the generated catalogue module
  coverageExclusions: ['tests/**', 'dist/**', 'public/src/whichrepo/**', '**/phones.generated.js'],
};
```

Every environment variable the tooling reads is named from `envPrefix`:

| Variable                          | Read by                                                       |
| --------------------------------- | ------------------------------------------------------------- |
| `<PREFIX>_SITE_ORIGIN`            | `createSiteMeta().resolveOrigin` — the canonical origin       |
| `<PREFIX>_RELEASE`                | `releaseMode` — `preview` or `public`; anything else refuses  |
| `<PREFIX>_PUBLISHER_NAME/EMAIL/…` | `readPublisher` — who publishes the site, at build time       |
| `<PREFIX>_PRODUCTION_URL`         | the deploy smoke plan, the uptime check, the production smoke |
| `<PREFIX>_E2E_TARGET`, `_E2E_PORT`, `_EXPECTED_BUILD` | the instance's `playwright.config.js`     |

## 2. The runtime record

What the browser modules read off a record. Anything else on a record is the instance's.

| Field                        | Meaning                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `id`                         | kebab-case slug; the key everywhere, and the seed of the marker colour                        |
| `name`                       | display name; ties on price and score are broken on it                                        |
| `purchasePrice`              | a finite number for a chart-eligible record, `null` for a price-pending one                   |
| `priceLow`, `priceHigh`      | the interval an estimated price names (optional; a point price omits them). An instance whose generator uses other names binds them with `configurePareto({ low, high })` |
| `scores`                     | `{ <ratingKey>: 0–N }` on the instance's rating scale (`ratingScale`, 5 by default)           |
| `scoreConfidence`            | `{ <ratingKey>: 'high' \| 'medium' \| 'low' }`                                                |
| `scoreEvidence`              | `{ <ratingKey>: <evidence level> }`, one of the instance's closed set of levels               |
| `chartEligible`, `eligible`  | the two explicit flags: scoreable, and additionally priced                                     |

`markPareto` adds `pareto`, `dominatedBy` and `dominance`; `rankItems` adds `rank` and `tiedRank`.

## 3. Dimensions

An array given once to `createWeightModel`:

```js
{ key: 'camera', ratingKey: 'camera', label: 'Camera', defaultWeight: 25,
  measures: 'What it reads, and what it does not.', shrinkage: { alpha: 0.6, mean: 3.4 } }
```

- `key` is the slider's identity and the key a saved allocation stores its weight under. It never
  changes once shipped: saved allocations are stored against it. Relabel freely; re-key never.
- `ratingKey` or `ratingKeys` name the keys on `scores` the dimension reads. Several are averaged,
  and a record rated on only some of them is unrated on the dimension.
- `defaultWeight`s must total 100.
- `shrinkage`, where the pooled sources barely agree, pulls a rating towards the mean before it is
  weighted. Derive `alpha` from measured inter-source agreement and pin it with a drift alarm.

When dimensions change, bump `storageSchemaVersion` and give `createWeightModel` a `migrate` hook
that brings an older saved allocation up to date rather than discarding it.

## 4. The generated catalogue

The instance's generator turns its YAML catalogue into one ES module the browser loads, with named
exports only (the bundler refuses anything else), and a `--check` mode that regenerates in memory and
compares byte for byte. CI fails on a stale module. The module exports at least the runtime array,
the full research catalogue, the presets and a `catalogueVersion`.

Two gates the generator enforces, whatever the domain: a record is **eligible** only with enough
evidenced dimensions resting on enough distinct documents (count documents by normalised URL, not
by citation — one review's chapters are one document), and **chart-eligible** only with a comparable
price in the site's market.

## 5. Crawlers

Every network reader lives in the instance's `data/refresh-*.mjs`, writes a dated snapshot, and:

- reads pages only through `node/fetch-page.mjs` (`createPageReader`), never the global `fetch`;
- exports `run({ fetchImpl, argv, … })` so a whole run is testable against captured pages;
- takes `--verify`, `--dry-run` and, where it reads a page per record, `--only=id,id` through
  `node/crawler-args.mjs` (`readOnly`, `checkOnlyIds`);
- merges a partial run onto the committed records with `mergeSnapshotRecords({ read, unread })`;
- sets `process.exitCode = exitCodeFor({ failed, changed })` and nowhere else;
- stamps the file date with `snapshotDate` and verified records with `stampVerified`.

`node/conventions.mjs` exports `crawlerConventionFindings`, which checks all of that structurally;
an instance's test asserts it returns `[]`. Parsers are pure, exported and unit-tested against
markup captured from a real page: they are the only place an outside document becomes a number.

## 6. Snapshots

A YAML file with `snapshot: YYYY-MM-DD` (the last complete full read), `source`, `policy` and a
`records:` list. Each record carries `id`, `accessed` (the day it was read), `url`, its readings with
explicit nulls for absent values, and optionally `verified_at`. A decision-style snapshot (several
candidate pages per record) carries `decision: { selected, basis, reason }` and `candidates: [{ url,
…figures }]`, keeping rejected candidates, and `snapshotDifferences(previous, next, { figures })`
reports what a re-read would change.

## 7. Vendoring the browser modules

The instance runs `which-vendor` after installing or bumping the package, commits the copies under
`paths.vendor`, and runs `which-vendor --check` in its `check` script and in CI. Its own browser
modules import from the vendored path (`./whichrepo/pareto.js`) and its build lists the vendored
files in dependency order before its own: `contrast.js`, `bands.js`, `pareto.js`, `weights.js`,
`scales.js`, `colour.js`.

Because the build concatenates, an instance module may **re-export** a vendored name but may not
**redeclare** it: `export { dominates } from './whichrepo/pareto.js'` is fine; a second top-level
`function dominates` is a SyntaxError in the browser and nowhere else. Bind the weight model's
functions to instance names through the factory instead (`export const rankCars = model.rankItems`).

## 8. Pages and metadata

`createSiteMeta({ name, pages, ogImage, locale })` gives the build canonical URLs, social preview
tags, `robots.txt` and `sitemap.xml` from one page list. Each page carries `slug`, `file`, `title`,
`description`, `priority` and the `sources` whose git history dates it. A page absent from the list
has no canonical URL and is absent from the sitemap, which is invisible until traffic does not
arrive, so a test in the instance holds the list to the files it ships. Numbers a page states about
the catalogue are written at build time with `substituteFacts` and held to the source page by a test
with `factsIn`.
