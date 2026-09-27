// The best-by-budget frontier: which items no other item beats on both price and score.
//
// The one thing this module takes from the weight model is the comparison the leaderboard's shared
// ranks use, so "outscored beyond the band" and "shares a rank" cannot disagree about the same pair.
// The width itself is still injected (`separation` below); nothing of any rubric is read here.
//
// Records carry their price as `purchasePrice` and, where the price is an estimate, its interval as
// `priceLow` and `priceHigh`. An instance whose generator names the interval differently binds its
// names once with `configurePareto` (Whichcar's generator emits `priceLowEur`/`priceHighEur`).
import { exceedsBand } from './bands.js';

export const PRICE_FIELDS = { low: 'priceLow', high: 'priceHigh' };

export function configurePareto({ low = PRICE_FIELDS.low, high = PRICE_FIELDS.high } = {}) {
  PRICE_FIELDS.low = low;
  PRICE_FIELDS.high = high;
  return { ...PRICE_FIELDS };
}

export function isComparable(item) {
  return Boolean(item) && Number.isFinite(item.purchasePrice) && Number.isFinite(item.score);
}

export function dominates(a, b) {
  if (!isComparable(a) || !isComparable(b)) return false;
  return (
    a.purchasePrice <= b.purchasePrice &&
    a.score >= b.score &&
    (a.purchasePrice < b.purchasePrice || a.score > b.score)
  );
}

// The interval a price actually names. A dated list price is a point: the item costs that. A
// converted or estimated price is published as a range, because the estimate's error is wider than
// the gap between many neighbouring items, and the low/high fields are that range. Reading the
// midpoint as the price is what let Whichcar's chart say a €45,931–€54,355 estimate is cheaper than
// a €53,000 list price.
export function priceBounds(item) {
  const low = Number.isFinite(item?.[PRICE_FIELDS.low]) ? item[PRICE_FIELDS.low] : item?.purchasePrice;
  const high = Number.isFinite(item?.[PRICE_FIELDS.high]) ? item[PRICE_FIELDS.high] : item?.purchasePrice;
  return [low, high];
}

// How well the evidence supports "a is the better buy than b", for a pair where it does on the
// point estimates. #82: the ranking has grouped cars by their measurement band since phase 3, and
// the frontier next to it went on declaring dominance from exact numbers -- so the same page could
// say two cars share a rank because nothing separates them, and that one of them is outscored by
// the other.
//
// Three answers, because there are three different situations and collapsing them loses the one
// that matters:
//
// - `robust`      the claim survives the uncertainty either side of it. The dearer car's cheapest
//                 possible price is still above the cheaper car's dearest, and the score gap is
//                 wider than the band that decides shared ranks on this same axis.
// - `estimated`   the point estimates say so and the evidence does not. Either the price ranges
//                 overlap, or the score gap is inside the band -- the leaderboard would give these
//                 two cars the same rank.
// - `unquantified` it would be robust, but the band it cleared covers only part of the visitor's
//                 weighting, so the real band is wider than the one it beat. A floor cannot
//                 establish a categorical claim.
//
// `separation(a, b)` is injected rather than imported so this module stays free of the scoring
// rubric: it returns `{ width, coveredShare }` or null, and null means nobody has derived a width
// for this pair, which is `unquantified` by the same argument.
export function dominanceVerdict(a, b, { separation } = {}) {
  if (!dominates(a, b)) return null;
  const [, aHigh] = priceBounds(a);
  const [bLow] = priceBounds(b);
  const gap = a.score - b.score;
  // Worst case for the dominator against best case for the dominated. Equal exact prices satisfy
  // it, which is right: dominance by score alone does not need a price gap.
  const priceClear = Number.isFinite(aHigh) && Number.isFinite(bLow) && aHigh <= bLow;
  const measured = separation ? separation(a, b) : null;
  const width = Number.isFinite(measured?.width) ? measured.width : null;
  // Wider than the band, not equal to it: at exactly the band the leaderboard calls the pair a shared
  // rank, and the two views have to agree -- including when binary rounding puts a gap that *is* the
  // band a hair either side of it, which a strict `gap > width` let decide.
  const scoreClear = width !== null && exceedsBand(gap, width);
  const coveredShare = Number.isFinite(measured?.coveredShare) ? measured.coveredShare : null;
  const verdict =
    !priceClear || !scoreClear
      ? 'estimated'
      : coveredShare === null || coveredShare < 1
        ? 'unquantified'
        : 'robust';
  return { verdict, priceClear, scoreClear, gap, width, coveredShare };
}

const VERDICT_ORDER = { robust: 0, unquantified: 1, estimated: 2 };

// Returns the most useful dominator to name in the UI — the best-evidenced claim first, then the
// highest scoring alternative, then the cheapest — rather than whichever record happens to come
// first in catalogue order. Naming the highest scorer alone would put "Outscored by X" on a row
// whose X is only estimated to be cheaper while a second car outscores it beyond any doubt, and the
// weaker claim would be the one the visitor reads.
//
// #129. Each dominator's verdict is computed once, before the sort, and handed back with the item so
// `markPareto` does not compute the winner's a second time. It used to be computed inside the
// comparator -- twice per comparison, and each one asks `separation` for two per-item bands -- which
// on the 122 comparable cars of Whichcar's full catalogue was 25,543 separation calls and 160 of a
// 180 ms render. The order is unchanged: the same comparator over the same keys, on a stable sort.
function rankedDominators(candidate, cars, options) {
  if (!isComparable(candidate)) return [];
  return cars
    .filter((other) => other.id !== candidate.id && dominates(other, candidate))
    .map((car) => {
      const verdict = dominanceVerdict(car, candidate, options);
      return { car, verdict, order: VERDICT_ORDER[verdict?.verdict ?? 'estimated'] };
    })
    .sort(
      (a, b) =>
        a.order - b.order ||
        b.car.score - a.car.score ||
        a.car.purchasePrice - b.car.purchasePrice ||
        String(a.car.name ?? a.car.id).localeCompare(String(b.car.name ?? b.car.id)),
    );
}

export function findDominatingItem(candidate, items = [], options = {}) {
  return rankedDominators(candidate, items, options)[0]?.car ?? null;
}

export function getParetoFrontier(items = []) {
  const valid = items.filter((car) => Number.isFinite(car.purchasePrice) && Number.isFinite(car.score));
  const sorted = [...valid].sort(
    (a, b) =>
      a.purchasePrice - b.purchasePrice ||
      b.score - a.score ||
      String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)),
  );
  const frontier = [];
  let bestScore = -Infinity;
  let lastPrice = null;
  for (const car of sorted) {
    if (lastPrice === car.purchasePrice && car.score <= bestScore) continue;
    if (car.score > bestScore) {
      frontier.push(car);
      bestScore = car.score;
    }
    lastPrice = car.purchasePrice;
  }
  return frontier.sort((a, b) => a.purchasePrice - b.purchasePrice);
}

// `pareto` stays the point-estimate frontier -- it is what the chart draws, and a frontier redrawn
// from intervals would be a different and much larger set that no longer answers "what sets a new
// highest score as the budget rises". What travels with it now is `dominance`: how well the
// evidence supports the one claim the UI makes out loud about a dominated car.
export function markPareto(items = [], scoreKey = 'personalisedScore', options = {}) {
  const comparable = items.map((item) => ({ ...item, score: item[scoreKey] })).filter(isComparable);
  return items.map((car) => {
    const candidate = { ...car, score: car[scoreKey] };
    if (!isComparable(candidate)) return { ...car, pareto: false, dominatedBy: null, dominance: null };
    // The winner's verdict is the one already computed to rank it. `comparable` carries `score` as
    // `item[scoreKey]`, so this is the same call the old second `dominanceVerdict` made.
    const [best] = rankedDominators(candidate, comparable, options);
    const dominatedBy = best?.car ?? null;
    return {
      ...car,
      pareto: dominatedBy === null,
      dominatedBy,
      dominance: best ? best.verdict : null,
    };
  });
}
