# Starting a new which\* site

The shortest honest path from an idea to a deployed instance. Whichcar is the worked example for
every step; where this page says "see Whichcar", the file it names is the one to copy and rename.

## 0. Before writing code: measure

Half the candidate dimensions for Whichcar's last scoring change turned out to be unusable, and
finding that first avoided building on them. For the new domain, before anything else:

1. List the dimensions a buyer actually weighs, and for each the **published, dated, per-item
   source** it could be read from. No source, no dimension.
2. Probe each source once (`node/fetch-page.mjs` and a throwaway parser) and record: coverage across
   a candidate catalogue, whether the measurement standard is stated, whether the page names the
   variant it describes.
3. Compute correlations between the candidate dimensions on the probe data (`pearson` in
   `node/stats.mjs`). Two axes above r = 0.9 are one axis.
4. Decide the price basis: which market, which channel, what a "list price" is here, and how an
   estimate will be banded when the list price is missing.

Write it up as the instance's `docs/catalogue-research.md` before writing the rubric.

## 1. Repository layout

```
whichphone/
  which.config.mjs            name, paths, prefix               (docs/instance-contract.md §1)
  package.json                depends on github:alezenonos/Whichrepo#<sha>
  data/
    phones.yaml               the catalogue, hand-edited facts + generated score_assessment blocks
    <source>-results.yaml     one dated snapshot per source
    assess-phones.mjs         the rubric: snapshots -> score_assessment, offline, deterministic
    refresh-<source>.mjs      one crawler per source              (docs/instance-contract.md §5)
    fetch-page.mjs            export * from 'whichrepo/node/fetch-page.mjs'   (see §3 below)
    crawler-args.mjs          export * from 'whichrepo/node/crawler-args.mjs'
    merge-snapshot.mjs        export * from 'whichrepo/node/merge-snapshot.mjs'
  scripts/
    generate-phones.mjs       phones.yaml -> public/src/phones.generated.js (+ evidence.json), --check
    build.mjs                 bundle, hash, rewrite index.html, robots, sitemap  (copy Whichcar's)
    site-meta.mjs             createSiteMeta({ name: 'WhichPhone', pages: [...] })
    publisher.mjs             binds the prefix: releaseMode(env, 'WHICHPHONE') ...
  public/
    index.html  styles.css  404.html  privacy.html  terms.html  contact.html
    src/
      whichrepo/              vendored by `which-vendor`, committed, checked in CI
      scoring.js              DIMENSIONS + createWeightModel(...) + the band tables
      pareto.js               export { ... } from './whichrepo/pareto.js' (+ configurePareto if needed)
      app.js                  the page (start from Whichcar's; see docs/status.md for what is generic)
      phones.js               re-exports phones.generated.js
  tests/                      node:test; every test comment names the defect it prevents
  .github/workflows/          ci.yml, deploy-smoke.yml, uptime.yml, catalogue-freshness.yml
  vercel.json                 headers, cleanUrls; the CSP hash of the one inline script
```

## 2. `package.json` scripts

```json
{
  "test": "node --test",
  "lint": "which-lint",
  "verify": "npm run lint && npm test",
  "coverage": "which-coverage",
  "coverage:check": "which-coverage --check",
  "vendor": "which-vendor",
  "vendor:check": "which-vendor --check",
  "preview": "which-preview",
  "generate": "node scripts/generate-phones.mjs",
  "assess": "node data/assess-phones.mjs",
  "check": "npm run assess:check && node scripts/generate-phones.mjs --check && npm run vendor:check && npm run format:check && npm run lint && npm run coverage:check",
  "build": "npm run verify && node scripts/build.mjs"
}
```

## 3. Importing the package

Node-side modules import from the package directly, or through one-line re-export shims in `data/`
so the crawler convention check (`from './fetch-page.mjs'`) reads the same in every instance.
Browser-side modules import from the vendored copy, never from `node_modules`, because the dev
server serves `public/` as it is and the build concatenates a fixed file list.

## 4. The rubric

`assess-phones.mjs` reads every snapshot, scores every record on every dimension, writes the
`score_assessment` blocks back into the catalogue YAML, and has a `--check` mode. Per dimension it
records `value`, `confidence`, `evidence_level`, `method`, `rationale`, `source_refs` and `inputs`.
Copy Whichcar's shape (`data/assess-cars.mjs`, `scoreRecord`) and the rules in
`docs/methodology.md` §4–§5; the fitted-fallback, no-evidence-anchor and dropped-tier helpers are the
ones to keep. Freeze every fitted constant where it is used and add the drift alarm that re-derives
it.

## 5. The page

Start from Whichcar's `public/index.html`, `styles.css` and `app.js`. About three quarters of
`app.js` is domain-free (state, storage, sliders, chart, hit-testing, leaderboard, tooltip, share
links, shortlist); the rest is the car filters, the specs line, the safety line and the running-cost
scenario. `docs/status.md` names the sections and what still has to be lifted into this package.
Replace the storage namespace (`whichcar.*`, `whichcar-` caches, `__WHICHCAR_READY__`) with your
own everywhere, including the inline boot script — and then recompute the CSP hash in `vercel.json`,
because the inline script is what it hashes.

## 6. Deploying

`vercel.json` installs and bundles; CI is the gate. Set the repository variable
`<PREFIX>_PRODUCTION_URL` and the secret `VERCEL_AUTOMATION_BYPASS_SECRET`, copy Whichcar's
workflows and rename the prefix, and read Whichcar's `docs/deployment.md` for the rest.

## 7. What to write down

`docs/methodology.md` (the site's own, with every departure from the shared one), `docs/status.md`
(the honest state and ranked next steps) and `CLAUDE.md` (the rules, each with the defect it came
from). A new instance starts with the shared rules and adds its own as they are learned.
