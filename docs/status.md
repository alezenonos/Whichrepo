# Project status

**Last reviewed:** 27 September 2026, when this repository was created from Whichcar.

## What is here

Ported from Whichcar with their tests and the defects those tests record, parametrised where they
named the site:

| Area                     | Modules                                                                                   | Tests |
| ------------------------ | ----------------------------------------------------------------------------------------- | ----- |
| Weight model             | `browser/weights.js` (`createWeightModel`), `browser/bands.js`                            | 76    |
| Frontier                 | `browser/pareto.js` (`configurePareto` for an instance's interval field names)             | 24    |
| Chart arithmetic         | `browser/scales.js` (nice domains, log price axis, step line), `browser/colour.js`        | 14    |
| Accessibility            | `browser/contrast.js`                                                                     | 8     |
| Crawler infrastructure   | `node/fetch-page.mjs`, `node/crawler-args.mjs`, `node/merge-snapshot.mjs`, `node/snapshot-diff.mjs`, `node/conventions.mjs` | 82 |
| Build and deploy tooling | `node/bundle.mjs`, `node/lint.mjs`, `node/coverage-badge.mjs`, `node/preview-server.mjs`, `node/site-meta.mjs`, `node/publisher.mjs`, `node/deploy-smoke-plan.mjs`, `node/report-alert.mjs` | 85 |
| Statistics               | `node/stats.mjs` (`pearson`, `groupedHoldout`, `leaveOneOut`, `midRankPercentile`, …)     | 16    |
| Instance plumbing        | `node/config.mjs`, `node/vendor.mjs`, `bin/*`                                             | 7     |

311 tests, coverage 92% of lines, all domain-free: the weight-model tests compare phones.

## What is deliberately not here yet

Each is generic in shape and car-specific in content today, and each is a next step rather than an
omission. Ranked by how much a second instance would save.

1. **The page (`app.js`).** About three quarters of Whichcar's 4,400 lines are domain-free — state,
   storage sanitising, sliders, chart render and hit-testing, leaderboard, tooltip, share links,
   shortlist, comparison — and a quarter is car content mixed in (four filters on car fields, the
   specs line, the Euro NCAP line, the running-cost scenario, and about forty inline phrases). The
   lift is to split it into a framework page driven by an instance's vocabulary (item noun, market,
   currency, locale, axis title), filter spec, and hooks for the specs line, extra panel facts and a
   scenario. Not done here because the copy is pinned by dozens of tests and the split needs a DOM
   harness the instance does not have yet. Until then a new instance starts from Whichcar's
   `app.js` and `index.html` and edits (`docs/new-instance.md` §5).
2. **The band and provenance model** (the rest of `scoring.js`: `EVIDENCE_BANDS`, `dimensionBand`,
   `sliderBand`, `dimensionSeparation`, `personalisedResolution`, `scoreSeparation`, `sliderProvenance`,
   `weightedProvenance`). The mechanics are generic; the tables are Whichcar's. A factory alongside
   `createWeightModel` that takes the tables is the next port, and the one that lets the frontier's
   verdict and the shared ranks reach a new instance for free.
3. **Generator mechanics** (`generate-cars.mjs`): YAML in, one ES module and an evidence JSON out,
   `--check`, source validation (`id`, `title`, `url`, `accessed`, HTTPS, no generic pages),
   citation integrity, distinct-document counting by normalised URL, the eligible/chart-eligible
   gates with policy thresholds. About 300 of its 1,200 lines. The instance keeps its field
   validation.
4. **Assessor scaffolding** (`assess-cars.mjs`): the CLI guard, `--check` byte-compare, the YAML
   block rewrite, the manifest (`buildManifest`: hashes of every input and every scoring module),
   `noEvidence`, `droppedTier`/`dropIf`, `editorialConfidence`, `measureOutletAgreement`. About 400
   of 3,700 lines; the rest is the car rubric.
5. **Audits**: the freshness audit's mechanics (`recordReadDate`, `snapshotAge`, gates, windows,
   `actionable`), the citation audit pattern, the golden-file probe sweep, the canary judge, the
   corroboration alarm. Each is a generic engine over a car-specific table.
6. **Validation** (`validate-scoring.mjs`): the holdout, sensitivity, calibration and overlap
   sections and the thresholds-with-reasons gate. The statistics they rest on are already in
   `node/stats.mjs`.
7. **The workflows** (`deploy-smoke.yml`, `uptime.yml`, the two weekly audits) as reusable
   workflows or a template, and `uptime-check.mjs` with its content markers as parameters.
8. **A test kit**: the scripted-fetch stub, the URL-to-body "world" replay, the crawler-run
   harness with a temp snapshot, and `globalThis` stubs for storage. Whichcar repeats each in five
   to eight test files.
9. **A scaffold** (`npm create which`) that writes the layout in `docs/new-instance.md`.

## How Whichcar consumes this

Whichcar pins this package by commit in its `package.json`, re-exports the Node modules from its
own `data/` and `scripts/` files (so its crawler convention test reads the same), vendors `browser/`
into `public/src/whichrepo/` and re-exports from its own `pareto.js`, `contrast.js`, `scoring.js`
and `app.js`. Its `npm run check` runs `which-vendor --check`. See Whichcar's `docs/architecture.md`.

## Start here in a new session

- Establish the green baseline: `npm install && npm run check`.
- The next port is item 2 above. Read `public/src/scoring.js` in Whichcar from line 264 to 760,
  design `createBandModel({ dimensions, evidenceBands, imputedComponentBands })`, and move
  `tests/metric-resolution.test.js`'s generic cases with it.
- Whichcar's `CLAUDE.md` lists `LUXURY_RANGE_FIT` among its frozen constants; that constant no longer
  exists (it is `LUXURY_STAND_IN_FIT`). Fix it when next in that file.
