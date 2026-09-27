# Whichrepo

![coverage](docs/coverage.svg)

The parent of the which\* comparison sites. [Whichcar](https://github.com/alezenonos/Whichcar) is
the first instance; whichphone, whichproperty and the rest will be the next. Each one answers the
same question about a different kind of thing: **what is the best one for my money, on my
priorities, and how sure can I be?**

Every instance is a static, dependency-light site with the same shape:

- a catalogue of records, each with a price and a set of ratings on a handful of dimensions;
- sliders that let the visitor weight those dimensions, always totalling 100%;
- a chart of price against the weighted score, with the best-by-budget frontier marked;
- a leaderboard that shares a rank between items the evidence cannot separate;
- and, behind every number, a dated document it was read from.

This package holds what is the same across them and nothing that is specific to one:

| Directory  | What it holds                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| `browser/` | The weight model, the frontier, the chart's axis arithmetic, accessible marker colours, WCAG contrast.  |
| `node/`    | The bundler, lint, coverage badge, preview server, site metadata, the crawler transport and merge rules, statistics. |
| `bin/`     | `which-lint`, `which-coverage`, `which-preview`, `which-vendor`: the CLIs an instance's `package.json` calls. |
| `docs/`    | The methodology every instance inherits, the contract an instance meets, how to start a new one.        |

## Using it in an instance

```bash
npm install github:alezenonos/Whichrepo#<commit>
npx which-vendor           # copies browser/ into public/src/whichrepo/, committed like generated data
```

Then read [`docs/new-instance.md`](docs/new-instance.md) for the file layout an instance needs and
[`docs/instance-contract.md`](docs/instance-contract.md) for what its records, crawlers and config
have to provide. [`docs/methodology.md`](docs/methodology.md) is the method itself — how a
recommendation is produced and what the site does when the evidence is thin — written so it can be
adopted by a site that compares something other than cars. [`docs/domains.md`](docs/domains.md) lists
the domains worth building next and what would be hard about each.

## Developing this package

```bash
npm install
npm run verify      # lint + tests
npm run check       # what CI runs, including the coverage badge gate
```

`CLAUDE.md` has the working rules and the defects each one was learned from.
