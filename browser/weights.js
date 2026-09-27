// The weight model: how a visitor's priorities become a percentage allocation that always totals
// 100, how that allocation and a record's ratings become one score, and how scores become ranks.
//
// Everything here is domain-free. What a site *has* -- its dimensions, the scale its ratings are on,
// the storage schema its saved allocations carry and the migrations older allocations need -- is
// given once to `createWeightModel`, which returns the functions bound to it. An instance re-exports
// them under whatever names its app uses; nothing in this file knows what is being compared.
//
// A dimension is `{ key, label, defaultWeight, ratingKey | ratingKeys, shrinkage? }`:
//   key           the slider's identity, and the key a saved allocation stores its weight under
//   ratingKey(s)  the key(s) on a record's `scores` the dimension reads; several are averaged, and a
//                 record rated on only some of them is not rated on the dimension
//   defaultWeight the percentage the slider starts at; the defaults must total 100
//   shrinkage     optional `{ alpha, mean }`: see `effectiveRating`
import { exceedsBand, parseFiniteNumber } from './bands.js';

export function ratingKeysOf(dimension) {
  return dimension.ratingKeys ?? [dimension.ratingKey ?? dimension.key];
}

export function dimensionRating(scores = {}, dimension) {
  const keys = ratingKeysOf(dimension);
  const values = keys.map((key) => parseFiniteNumber(scores?.[key])).filter((value) => value !== null);
  if (values.length !== keys.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// What a dimension is allowed to contribute to the weighted total, as against what it reads.
//
// The two are the same for every dimension a rubric can call firm. They are not the same where the
// sources pooled for a dimension barely agree: when most of the spacing between adjacent items is
// disagreement between reviewers rather than a difference between items, weighting that spacing at
// face value lets the noisiest axis move a total further than its evidence can carry it.
//
// So a weak dimension is pulled towards the catalogue mean by its own reliability,
// `mean + alpha x (raw - mean)`. It is a linear transform, so the order of items within the
// dimension is untouched; and it is deliberately not applied to the single-dimension chart axis,
// which shows what the sources published rather than what it may move.
//
// The alternative -- lowering the default weight of a weak dimension -- was rejected: the weights are
// the visitor's statement of what they care about, and quietly discounting one is answering a
// different question from the one they asked.
export function effectiveRating(rating, dimension) {
  if (rating === null || !dimension?.shrinkage) return rating;
  const { alpha, mean } = dimension.shrinkage;
  return Math.round((mean + alpha * (rating - mean)) * 1000) / 1000;
}

// Rounds `values` to integers that sum to exactly `total`. The contract is the whole point of the
// function -- every caller uses it to keep an allocation on 100 -- so it has to hold in both
// directions. It previously only topped up: when the floors already summed above `total` the
// shortfall went negative, the top-up loop did not run, and the function returned a set summing
// above what was asked for, silently. Whichcar's slider rebalancing fed it exactly that, and the
// nine sliders reached 112%. A rounder that returns the wrong total on some inputs is worse than
// one that throws, because every caller here treats the result as normalised and stops checking.
export function largestRemainderRound(values = [], total = 100) {
  const floors = values.map((value, index) => ({
    index,
    floor: Math.floor(value),
    remainder: value - Math.floor(value),
  }));
  if (!floors.length) return [];
  const order = [...floors].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  let shortfall = total - floors.reduce((sum, item) => sum + item.floor, 0);
  // Largest remainders are served first, then the cycle repeats: `order[i]` used to run off the
  // end when the shares summed well below `total`, and the `?? 0` fallback dumped every surplus
  // point onto the first entry rather than spreading them.
  for (let i = 0; shortfall > 0; i += 1, shortfall -= 1) floors[order[i % order.length].index].floor += 1;
  // Give-back pass, smallest remainder first, and never below zero -- a negative weight would
  // reach the score as a subtraction. If nothing can be taken the loop stops rather than spinning:
  // `total` is then below what a non-negative allocation can reach and the caller asked for the
  // impossible.
  while (shortfall < 0) {
    let removed = 0;
    for (let i = order.length - 1; i >= 0 && shortfall < 0; i -= 1) {
      const item = floors[order[i].index];
      if (item.floor <= 0) continue;
      item.floor -= 1;
      shortfall += 1;
      removed += 1;
    }
    if (!removed) break;
  }
  return floors.sort((a, b) => a.index - b.index).map((item) => item.floor);
}

// Competition ranking: items on the same score share a rank and the ranks they share are skipped,
// so a leaderboard reading 1, 2, 2, 4 says what it means.
//
// `tolerance` widens "the same score" into "not separated by the evidence". Each item is compared
// with its group's *leader*, never with the row above it: chaining lets a group grow without limit
// -- 80, 79, 78 at a tolerance of 1.5 would tie all three, though 80 and 78 are two apart and the
// evidence does resolve that. Anchoring on the leader makes a shared rank mean one checkable thing,
// "not separated from the item at the top of this group".
// `tolerance` may be a number or a function of (groupLeader, item), so the band can follow each
// item's own evidence: the width between a well-evidenced leader and a rival standing on anchors is
// wider than between two measured items, and one constant for the whole list has to be either too
// tight for the first pair or too loose for the second. A width of 0 is exact equality, to within
// the float noise `exceedsBand` always allows.
export function rankTiedScores(sorted, scoreOf, tolerance = 0) {
  let rank = 0;
  let leader = null;
  let leaderItem = null;
  const widthFor = (item) => (typeof tolerance === 'function' ? tolerance(leaderItem, item) : tolerance);
  const ranks = sorted.map((item, index) => {
    const score = scoreOf(item);
    if (leader === null || exceedsBand(Math.abs(score - leader), widthFor(item))) {
      rank = index + 1;
      leader = score;
      leaderItem = item;
    }
    return rank;
  });
  return sorted.map((item, index) => ({
    ...item,
    rank: ranks[index],
    tiedRank: ranks.filter((value) => value === ranks[index]).length > 1,
  }));
}

export function formatScore(score, digits = 1) {
  return score === null || !Number.isFinite(score) ? 'Unavailable' : Number(score).toFixed(digits);
}

export function createWeightModel({
  dimensions,
  // The top of the rating scale a record's `scores` are on: 5 for a five-point rubric, 10 for a
  // ten-point one. Scores are published out of 100 whatever the scale.
  ratingScale = 5,
  // Stamped on every saved allocation, so a payload from an older schema is migrated rather than
  // trusted. Bump it when the dimensions change.
  storageSchemaVersion = 1,
  weightUnit = 'percent',
  // How a saved allocation from an older schema is brought up to date before it is validated:
  // `(candidate, dimensions) => candidate`, given the stored weights object. The default keeps it as
  // it is, which is right for a site whose dimensions have never changed. Whichcar's splits two
  // sliders that were once one.
  migrate = (candidate) => candidate,
  // The composite metric's key, under which the weighted score is stored on a ranked item.
  scoreKey = 'personalisedScore',
} = {}) {
  if (!Array.isArray(dimensions) || !dimensions.length) throw new Error('createWeightModel needs dimensions');
  const DEFAULT_WEIGHTS = Object.fromEntries(dimensions.map((d) => [d.key, d.defaultWeight]));
  const defaultTotal = Object.values(DEFAULT_WEIGHTS).reduce((sum, value) => sum + value, 0);
  if (defaultTotal !== 100)
    throw new Error(
      `the default weights must total 100 and total ${defaultTotal}: ${JSON.stringify(DEFAULT_WEIGHTS)}`,
    );
  const axisFactor = 100 / ratingScale;

  function weightsToArray(weights = {}, dims = dimensions) {
    return dims.map((dimension) => Number(weights[dimension.key]));
  }

  function arrayToWeights(values = [], dims = dimensions) {
    return Object.fromEntries(dims.map((dimension, index) => [dimension.key, values[index] ?? 0]));
  }

  function weightTotal(weights = {}, dims = dimensions) {
    return weightsToArray(weights, dims).reduce(
      (sum, value) => sum + (Number.isFinite(value) ? value : 0),
      0,
    );
  }

  function validPercentWeights(weights = {}, dims = dimensions) {
    const values = weightsToArray(weights, dims);
    return (
      values.length === dims.length &&
      values.every((value) => Number.isInteger(value) && value >= 0 && value <= 100) &&
      values.reduce((sum, value) => sum + value, 0) === 100
    );
  }

  function normalizePercentWeights(weights = {}, dims = dimensions) {
    const values = weightsToArray(weights, dims);
    if (
      values.length !== dims.length ||
      values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)
    )
      return { ...DEFAULT_WEIGHTS };
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return { ...DEFAULT_WEIGHTS };
    return arrayToWeights(
      largestRemainderRound(
        values.map((value) => (100 * value) / total),
        100,
      ),
      dims,
    );
  }

  // When one slider changes, the remaining percentage is redistributed across the other dimensions
  // in proportion to `baseWeights` (the allocation at the start of the drag, so a long drag does not
  // compound its own rounding), using largest-remainder rounding so the total stays exactly 100.
  function rebalanceWeights(
    previousWeights = DEFAULT_WEIGHTS,
    changedKey,
    requestedValue,
    baseWeights = previousWeights,
    dims = dimensions,
  ) {
    const target = Math.max(0, Math.min(100, Math.round(Number(requestedValue))));
    const changedIndex = dims.findIndex((dimension) => dimension.key === changedKey);
    if (changedIndex < 0) return normalizePercentWeights(previousWeights, dims);
    if (target === 100)
      return arrayToWeights(
        dims.map((_, index) => (index === changedIndex ? 100 : 0)),
        dims,
      );
    const baseValues = weightsToArray(baseWeights, dims).map((value) =>
      Number.isFinite(value) && value >= 0 ? value : 0,
    );
    let otherTotal = baseValues.reduce(
      (sum, value, index) => (index === changedIndex ? sum : sum + value),
      0,
    );
    let distribution = baseValues;
    if (otherTotal <= 0) {
      distribution = dims.map((dimension) => dimension.defaultWeight);
      otherTotal = distribution.reduce(
        (sum, value, index) => (index === changedIndex ? sum : sum + value),
        0,
      );
    }
    const remaining = 100 - target;
    const rawOthers = dims
      .map((_, index) => (index === changedIndex ? null : (remaining * distribution[index]) / otherTotal))
      .filter((value) => value !== null);
    const roundedOthers = largestRemainderRound(rawOthers, remaining);
    const next = [];
    let otherIndex = 0;
    dims.forEach((_, index) => {
      next[index] = index === changedIndex ? target : roundedOthers[otherIndex++];
    });
    return arrayToWeights(next, dims);
  }

  // A saved allocation is untrusted. It is parsed, identified by the schema version and unit it
  // carries, migrated where it is out of date, and validated; anything that cannot be identified is
  // replaced by the defaults rather than guessed at, because the wrong guess is silent: reading an
  // unmarked allocation as percentages when it was 0-5 sliders restores a set of priorities the
  // visitor never chose and then scores every item against it.
  function migrateStoredWeights(payload, dims = dimensions) {
    const rejected = { weights: { ...DEFAULT_WEIGHTS }, migrated: false, valid: false };
    if (!payload) return rejected;
    let parsed = payload;
    if (typeof payload === 'string') {
      try {
        parsed = JSON.parse(payload);
      } catch {
        return rejected;
      }
    }
    const stored = parsed?.weights ?? parsed;
    const outOfDate = parsed?.weightSchemaVersion !== storageSchemaVersion;
    const candidate = outOfDate ? migrate(stored, dims) : stored;
    const values = weightsToArray(candidate, dims);
    const structurallyValid =
      values.length === dims.length && values.every((value) => Number.isFinite(value) && value >= 0);
    if (!structurallyValid) return rejected;
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return rejected;
    if (
      parsed?.weightSchemaVersion === storageSchemaVersion &&
      parsed?.weightUnit === weightUnit &&
      values.every((value) => value <= 100)
    ) {
      const weights = normalizePercentWeights(candidate, dims);
      return { weights, migrated: false, valid: validPercentWeights(weights, dims) };
    }
    // Either an allocation on the rating scale itself (the original five-point sliders), or a
    // percentage allocation from an older schema that the migration has just brought up to date.
    // Both renormalise to an exact 100 and both count as a migration.
    if (
      values.every((value) => value <= ratingScale) ||
      (parsed?.weightUnit === weightUnit && values.every((value) => value <= 100))
    ) {
      return {
        weights: arrayToWeights(
          largestRemainderRound(
            values.map((value) => (100 * value) / total),
            100,
          ),
          dims,
        ),
        migrated: true,
        valid: true,
      };
    }
    return rejected;
  }

  function persistableWeights(weights) {
    return { weightSchemaVersion: storageSchemaVersion, weightUnit, weights };
  }

  function calculatePersonalisedScore(scores = {}, weights = {}, dims = dimensions, options = {}) {
    let workingWeights = weights;
    if (!validPercentWeights(weights, dims)) {
      if (options.productionFallback || globalThis?.process?.env?.NODE_ENV === 'production') {
        console.warn?.('Invalid percentage weight allocation reached scorer; normalising safely.', weights);
        workingWeights = normalizePercentWeights(weights, dims);
      } else {
        console.assert(
          validPercentWeights(weights, dims),
          'Weight total must be exactly 100 before scoring',
          weights,
        );
      }
    }
    let total = 0;
    let hasRating = false;
    for (const dimension of dims) {
      const weight = Number(workingWeights[dimension.key]);
      // A dimension the visitor has given no weight to is genuinely not part of their question,
      // so it is skipped whether or not it has a rating.
      if (!Number.isFinite(weight) || weight <= 0) continue;
      const rating = dimensionRating(scores, dimension);
      // A dimension the visitor *is* asking about but which this item has no rating for cannot be
      // skipped: skipping contributes nothing, which silently scores the item as if it had rated
      // zero and ranks it below items that were merely measured. There is no score to publish.
      if (rating === null) return null;
      total += (weight * effectiveRating(rating, dimension)) / ratingScale;
      hasRating = true;
    }
    return hasRating ? total : null;
  }

  // The value plotted on the y axis: the weighted score for the composite metric, or a single
  // dimension's published rating drawn on the same 0-100 axis.
  function getMetricValue(item, metricKey, weights) {
    if (metricKey === scoreKey) return calculatePersonalisedScore(item.scores, weights);
    const dimension = dimensions.find((entry) => entry.key === metricKey);
    const rating = dimension ? dimensionRating(item.scores, dimension) : null;
    return rating === null ? null : rating * axisFactor;
  }

  function compareRanked(a, b) {
    const scoreDiff = (b[scoreKey] ?? -Infinity) - (a[scoreKey] ?? -Infinity);
    if (exceedsBand(Math.abs(scoreDiff), 0)) return scoreDiff;
    const priceDiff = (a.purchasePrice ?? Infinity) - (b.purchasePrice ?? Infinity);
    if (priceDiff !== 0) return priceDiff;
    return String(a.name ?? a.id).localeCompare(String(b.name ?? b.id));
  }

  // `tolerance` is passed through so a caller can rank the way the app does rather than approximate
  // it. Cheapest first inside a shared rank, so a caller ranking through this function sees the
  // order the page renders.
  function rankItems(items = [], tolerance = 0) {
    const ranked = rankTiedScores(
      [...items].sort(compareRanked),
      (item) => item[scoreKey] ?? -Infinity,
      tolerance,
    );
    const ordered = [];
    for (let start = 0; start < ranked.length;) {
      let end = start;
      while (end < ranked.length && ranked[end].rank === ranked[start].rank) end += 1;
      ordered.push(
        ...ranked
          .slice(start, end)
          .sort(
            (a, b) =>
              (a.purchasePrice ?? Infinity) - (b.purchasePrice ?? Infinity) ||
              String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)),
          ),
      );
      start = end;
    }
    return ordered;
  }

  return {
    dimensions,
    ratingScale,
    axisFactor,
    scoreKey,
    storageSchemaVersion,
    weightUnit,
    DEFAULT_WEIGHTS,
    weightsToArray,
    arrayToWeights,
    weightTotal,
    validPercentWeights,
    normalizePercentWeights,
    rebalanceWeights,
    migrateStoredWeights,
    persistableWeights,
    calculatePersonalisedScore,
    getMetricValue,
    compareRanked,
    rankItems,
  };
}
