# The method every which\* site inherits

This is the method behind Whichcar, written without the cars. A new instance adopts it whole; where
it cannot, the departure is written down in that instance's own methodology page with the reason.

## 1. The pitch

Choosing among a hundred things across a dozen dimensions that matter differently to different
people, on evidence scattered across test databases, magazine reviews, owner surveys and price lists
— most of it published about a different market than the one you are buying in.

The usual answers are a "top ten" whose ranking nobody can reproduce, or a spreadsheet whose weights
are somebody else's. A which\* site does three things instead:

1. **It makes the priorities yours.** A handful of sliders, always summing to 100%. There is no
   house opinion about whether one dimension matters more than another — you set that, and the whole
   ranking moves.
2. **It shows price against fit, not fit alone.** Every item is a point on a price-versus-match
   chart, with a **best at its price** line that answers "what is the best item at each price"
   rather than "what is the best item". An item is best at its price when it scores higher than
   every cheaper item; economists call the line a Pareto frontier, and the page does not.
3. **It says how firmly it knows each thing.** Every score carries an evidence level and a
   confidence tier, every price carries its basis and date, and an item nobody has tested is never
   quietly presented as an item that tested well.

The design rule behind all of it: **an honest "we do not know" beats a confident wrong answer.**

## 2. How a recommendation is produced

```
data/<catalogue>.yaml      the catalogue: one record per item sold or researched
  + frozen evidence        each source a dated, committed snapshot file
    snapshots
  → assess                 the rubric: turns evidence into one 0–N rating per dimension per item,
                           offline and deterministically, with a rationale and sources per score
  → generate               the runtime catalogue: the items the app is allowed to publish a score
                           for, and among them the ones with a comparable price and a place on the chart
  → the sliders            a weighted 0–100 match score per item, recomputed as they move
  → chart + leaderboard    price versus match score, with the best-at-its-price line
```

The match score is a weighted mean of the dimensions the visitor gave weight to, rescaled to 0–100
(`createWeightModel` in `browser/weights.js`). Two rules keep it honest:

- **A dimension set to zero is not part of the question**, so it is skipped entirely.
- **A dimension that is weighted but which an item has no rating for makes that item unscoreable**,
  and it is left out rather than scored as if it had rated zero. Silently skipping it would rank an
  unmeasured item above a measured one.

Assessment never touches the network. Running it twice produces a byte-identical catalogue, so any
score that moves has a reviewable cause: a snapshot changed, or the rubric did. CI checks the
assessment is current with its evidence *before* it checks the generated catalogue is current with
the assessment, because the second check passes happily when the first is stale.

## 3. What a dimension is

Each slider states what it reads **and what it does not read**, next to the slider, in the words a
visitor uses. A score that is one magazine's opinion of one trim in another market gets the same
disclosure a price gets.

Two dimensions that read the same physical variable in opposite directions carry, between them, the
model's opinion about that variable whatever the visitor sets. In Whichcar, Space and Manageability
both read exterior length, and until they were weighted equally the default ranking preferred large
cars without anybody having chosen that. Measure the correlation of the default score against every
raw variable in the catalogue before shipping a default allocation.

## 4. Evidence discipline

- **When the source does not say, reject rather than guess.** An unstated measurement standard is
  not evidence. If a publication prints a figure without saying which test cycle produced it, the
  figure is refused and the record goes unscored on that dimension.
- **Check what the source actually measured before scoring from it.** A field that mixes two
  standards (body width against mirror-inclusive width; turning radius against diameter) cannot be
  corrected by a constant. It is committed as evidence and not scored from, with a test pinning that.
- **Verify the document describes the item the record prices.** The recurring defect, in three
  forms: a review of a superseded generation, a performance sub-variant read as the base one, a
  stand-in variant read as the priced one. The verdict on a document is `match`, `proxy` (nothing
  contradicts, something is unverified: the reading stands with its scope disclosed and a dropped
  confidence tier) or `contradiction` (the document states a different physical fact: the reading is
  unusable). A contradiction is a statement, never an absence.
- **Never let absence become zero.** `Number(null)` is `0`. That pattern has published a 0 L boot
  and a 0 g/km petrol car. "Not known" is absence.
- **A failed fetch must never erase a committed reading.** The transport answers `read`, `withdrawn`
  (404/410: a fact about the publication) or `http_failure` (a fact about the network), and only the
  first two may change a reading.
- **Cite the document that publishes the figure.** Not the record's last source. A price page cited
  as the origin of a consumption figure is a false trail even when the number is right.
- **One yardstick for the whole catalogue.** If a term is missing for some records, predict it with a
  fitted fallback and drop a confidence tier — do not score those records on a different formula.
  Being measured must never become a scoring disadvantage.

## 5. Confidence, bands and shared ranks

Every score carries an **evidence level** (what kind of thing it rests on: a measured fact, a
prediction from a fit, a pooled verdict, a related cohort, the catalogue anchor) and a **confidence
tier** (`high`, `medium`, `low`). The rules that move a tier:

- a pooled verdict reaches `medium` only with two or more sources within a point of each other and a
  measured inter-source agreement above a floor (Cronbach's α ≥ 0.5 in Whichcar);
- a fitted prediction is one tier below what a measurement would carry;
- a document that is a proxy for the priced item drops the reading one tier;
- an item with no evidence on a dimension is published at the catalogue mean, rounded so it never
  lands below the evidenced mean, at the lowest level, with no sources.

Each evidence level carries a **band**: the error one standard deviation either side of the estimate
on the 0–100 axis, derived (never chosen) from the fit's own mean absolute error for a prediction,
from the spread of the field for an anchor, and from inter-source agreement for a pooled verdict. A
measured fact carries no band. The page then does three things with it:

- a weak axis prints as `88 ±14` with a note saying how many levels it actually resolves;
- two items closer together than the band **share a rank** rather than being ordered
  (`rankTiedScores`, anchored on the group leader so a group cannot chain without limit);
- an "outscored by" claim on the frontier is called `robust` only when the price intervals do not
  overlap and the score gap exceeds the same band; otherwise `estimated`, or `unquantified` when the
  band it cleared covers only part of the visitor's weighting.

The same comparison (`exceedsBand`) decides all three, because the page contradicts itself the moment
any two of them answer differently about one pair.

## 6. Price

A price is a point (a dated list price in the site's market) or an interval (a converted or
estimated price with its measured error band). Every price is rendered with its basis and as-of
date, an estimate is prefixed so it can never read as a figure you could pay, and an item with no
comparable price is listed under its own heading, never plotted at a placeholder and never eligible
for the frontier or the headline.

A budget filter is tested against the low end of a banded price, so an item whose estimate could
fall under the budget is kept rather than cut on a precision the estimate does not have.

## 7. What is frozen, and what re-derives it

Fitted constants (regressions, shrinkage alphas, resolution bands, inter-source agreement) are
frozen where they are used and re-derived by a test that fails when they drift from the catalogue
they describe. When one fails: first prove the formula still reproduces the committed value on the
old data, then re-derive on the new. That distinguishes "the catalogue grew" from "I changed the
definition".

Several tests pin exact expected values (the frontier, the first records' scores, the top five). They
are drift alarms, not obstacles: measure what moved and why, update the value, and add a comment
saying what changed it and by how much. A pin updated without a reason is indistinguishable from a
pin updated to hide a bug.

## 8. Validation outside the rubric

A separate, committed validation run holds the scoring model to evidence outside it:

- a **benchmark** of pairs ordered from documents rather than from the rubric, on which the rubric
  may not disagree;
- **grouped holdouts** of every fitted fallback, held out one brand at a time, with `skill` measured
  against predicting the mean (`groupedHoldout` in `node/stats.mjs`) — a fit with no skill is not
  carrying information about the item;
- **calibration** of every published band against held-out residuals, so the band means what it says;
- **sensitivity**: under ±5-point nudges to any slider no ranked pair may reverse, and the share of
  pairs whose shared-rank verdict changes is capped;
- **overlap**: the correlation matrix between axes and each axis's effective weight (nominal weight
  × spread), so a dimension that is a relabelled copy of another is visible.

Each threshold states its reason, and the committed baseline must be byte-identical to a fresh run.

## 9. Freshness

A record carries the date it was **read** and, separately, the date it was last **verified**
unchanged; a `--verify` run stamps the second and never touches a reading. The file-level snapshot
date advances only on a complete, full run. A scheduled audit reports readings older than a window
per source, gates (rule changes) that postdate the readings they govern, and price assumptions past
their review window, and opens one issue per condition that closes itself on the first passing run.
