// The two primitives every comparison on the page shares: how a number is read off a record, and
// whether a gap between two scores is wide enough to mean anything.
//
// They live apart from the weight model because the frontier needs the second without the first,
// and the bundle concatenates modules in order: what both need has to be defined once, before both.

export const SCORE_EPSILON = 0.0000001;

// The one test for "the evidence separates these two scores": the gap exceeds the band by more than
// binary noise. Every place that asks it -- the leaderboard's shared ranks, the frontier's
// "outscored by" claim, and the two equal-score sorts -- calls this, because the page contradicts
// itself the moment any two of them answer differently.
//
// The noise floor belongs to the comparison, not to the band. A strict `gap > band` let the last
// bit decide every pair whose gap *is* the band: 1.1 - 0.8 is 0.30000000000000004 and 0.7 - 0.4 is
// 0.29999999999999993, so at a band of 0.3 one pair was separated and the other tied. On the
// Whichcar catalogue, with the Running Costs fallback band at 26.0, the direct axis computed a gap as
// (4.9 - 3.6) x 20 and the 100%-weighted view as 98 - 72, and three cars ranked 1st one way and
// 101st the other. Here the floor covers every width, and a zero band means exact equality to within
// the same floor.
export function exceedsBand(gap, band) {
  return gap - band > SCORE_EPSILON;
}

export function parseFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
