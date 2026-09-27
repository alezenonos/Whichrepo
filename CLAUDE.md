# Working in this repository

Whichrepo is the parent of the which\* sites: Whichcar today, and whichphone, whichproperty and the
rest tomorrow. Every instance is the same product — an evidence-gated chart of price against a
weighted score, where the visitor sets the weights and the site says how firmly it knows each thing —
and this package holds what is the same across them. Nothing in it may name a car.

## Commands

```bash
npm install            # first, in a fresh clone
npm run verify         # lint + tests. Run before every commit.
npm run check          # what CI runs: format, lint, and the suite under coverage with the badge gate
npm test               # node --test
npm run coverage       # re-measure and rewrite docs/coverage.svg after adding or deleting tests
```

`npm run verify` does not check the coverage badge and CI does. Adding or deleting tests means
`npm run coverage` and committing `docs/coverage.svg`, or CI goes red at the last step.

## What lives here

- `browser/` — modules an instance vendors into its `public/` tree (see `docs/instance-contract.md`).
  They are concatenated into one classic script by the instance's build, so they use **named
  imports and exports only**: no `export default`, no `export *`, no `as` renames, no `import()`, no
  `import.meta`. `node/bundle.mjs` refuses anything else, and `tests/bundle.test.js` bundles every
  browser module in dependency order to prove it. Every top-level name across `browser/` must be
  unique, because after concatenation they share one scope.
- `node/` — build, test and crawler tooling an instance imports from `node_modules`. Anything that
  names a site (its brand, its environment prefix, its pages, its file paths) takes that as a
  parameter or through `createSiteMeta`/`createWeightModel`; the defaults are generic.
- `bin/` — the CLIs an instance runs from `package.json`: `which-lint`, `which-coverage`,
  `which-preview`, `which-vendor`. They read the instance's `which.config.mjs` (`node/config.mjs`).
- `docs/` — the methodology every instance inherits and the contract an instance has to meet.

## The rules the code was written under

Each of these was learned from a defect that shipped in Whichcar. They are not stylistic, and a
change that weakens one needs the defect it reintroduces named in the pull request.

- **Never let absence become zero.** `Number(null)` is `0`. `parseFiniteNumber`, `finite`,
  `exitCodeFor`'s `countOf` and `dimensionRating` all exist to refuse that. A missing rating makes
  the weighted score `null`, never a contribution of zero.
- **Distinguish "the source published nothing" from "we could not read the source".** `readPage`
  answers `read`, `withdrawn` or `http_failure` and never throws; `mergeSnapshotRecords` carries an
  unread record byte for byte and refuses to empty a populated snapshot.
- **A filter that is ignored looks exactly like a filter that matched everything.** `parseOnly`
  throws on `--only` with nothing after it; `checkOnlyIds` refuses an id the crawler cannot read.
- **Two views of one number must agree.** `exceedsBand` is the one test for "the evidence separates
  these two scores", used by ranks, the frontier's verdict and the sorts alike.
- **The visitor's weights are their statement.** A weak dimension is shrunk towards its mean
  (`effectiveRating`), never quietly given a lower default weight.
- **Every saved payload is untrusted.** `migrateStoredWeights` identifies a payload by the schema
  version and unit it carries, migrates it through the instance's hook, and replaces what it cannot
  identify with the defaults.
- **A gate that cries wolf gets disabled.** The coverage badge is compared as a number with a
  tolerance, not as bytes.

## Tests

`node:test` with `describe`/`it`. **A test comment states the real defect the test prevents**, with
the concrete case. Most of the tests here came from Whichcar with their defects attached; keep that
when adding one. Derive expectations from the module under test where possible.

The tests here use made-up dimensions (`tests/weights.test.js` compares phones) on purpose: a
framework test that reads a catalogue is an instance test in the wrong repository.

## Changing something an instance depends on

Instances pin this package by commit (`"whichrepo": "github:alezenonos/Whichrepo#<sha>"`) and vendor
`browser/` into their tree with `which-vendor`, so a change here reaches an instance only when it
bumps the pin and re-vendors. That is deliberate: a scoring change must arrive as a reviewable diff
in the instance. When you change a browser module, say in the commit message what an instance's
vendored copy will change and whether any pinned score can move.

## Docs

`docs/status.md` is the honest current state and carries the ranked next steps, including what has
not been ported from Whichcar yet and why. Update it when behaviour changes, and correct it when
the work proves it wrong.
