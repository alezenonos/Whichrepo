// Axis arithmetic for the chart: a linear scale, "nice" tick domains, and the logarithmic price
// axis. Pure functions of numbers; nothing here touches the DOM.

export function scale(v, a, b, c, d) {
  return b === a ? (c + d) / 2 : c + ((v - a) / (b - a)) * (d - c);
}

export function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export function previousNiceStep(step) {
  const pow = 10 ** Math.floor(Math.log10(step));
  const n = step / pow;
  if (n > 5) return 5 * pow;
  if (n > 2) return 2 * pow;
  if (n > 1) return pow;
  return pow / 2;
}

// A coarse tick step can round the domain out far beyond the data — at three ticks a €23k–€68k
// spread became a €0–€100k axis that squashed every point into one corner. Step down until the
// plotted domain stays close to the data it has to show.
//
// The old test measured total width against the data span, which let a €23k–€92k spread round out
// to a €0–€100k axis: 1.5x the span, under the limit, yet a quarter of the chart empty below the
// cheapest item. Measuring the padding at each end catches that. Stepping down adds ticks, so a
// step is only accepted while it keeps the axis within two ticks of the requested count —
// otherwise the cure is a 390px chart carrying ten labels.
export function niceDomain(vals, count, price = false) {
  const min = Math.min(...vals),
    max = Math.max(...vals),
    span = Math.max(max - min, price ? 1000 : 1);
  const maxTicks = count + 2;
  const overpadded = (lo, hi) => min - lo > span * 0.25 || hi - max > span * 0.25;
  const step = niceStep(span / Math.max(1, count - 1));
  // The tick budget is a preference; the padding rule is the reason this function exists. They were
  // the other way round until 2026-08-19: the step-down loop broke out when the next step would
  // exceed `maxTicks` and returned the overpadded domain anyway, which is the very outcome it is
  // here to prevent. A browser suite caught it when a price refit moved the dearest item across
  // 150,000 and a 50,000 step rounded a 23,400-152,474 field out to 0-200,000.
  //
  // The first repair only handled a spread the *next* step down fixed, and broke out otherwise --
  // so a 36,500-70,841 field kept a 20,000-80,000 axis, needing two steps to reach one that fits.
  // Searching the whole ladder rather than peeking one rung down is what fixes both, and a property
  // test over every preset is what found the second.
  //
  // `readableTicks` is the hard stop: an axis carrying a label every few pixels is not the cure for
  // one that wastes space.
  const readableTicks = 10;
  const tickCount = (a, b, by) => (b - a) / by + 1;
  const candidates = [];
  for (let s = step, guard = 0; guard < 12 && s > (price ? 100 : 0.1); guard += 1) {
    candidates.push([Math.floor(min / s) * s, Math.ceil(max / s) * s, s]);
    const next = previousNiceStep(s);
    if (!(next > 0) || next === s) break;
    s = next;
  }
  // Coarsest step that satisfies the padding rule and still reads. Candidates run coarse to fine,
  // so the first match is the fewest ticks that will do.
  const fits = candidates.find(([a, b, by]) => !overpadded(a, b) && tickCount(a, b, by) <= readableTicks);
  if (fits) return fits;
  // Nothing satisfies it. Fall back to the finest step inside the tick budget, which is what this
  // function did before the padding rule was allowed to outrank the budget.
  const inBudget = candidates.filter(([a, b, by]) => tickCount(a, b, by) <= maxTicks);
  return inBudget.length ? inBudget[inBudget.length - 1] : candidates[0];
}

export function ticks(d) {
  const out = [];
  for (let v = d[0]; v <= d[1] + d[2] / 2; v += d[2]) out.push(Math.round(v * 100000) / 100000);
  return out;
}

// ---------------------------------------------------------------------------------------------
// The price axis
// ---------------------------------------------------------------------------------------------
// The price axis is logarithmic. On a linear one Whichcar's default preset ran EUR 20k-160k to
// include six cars above EUR 95k while 35 of its 55 cars sat between EUR 25k and EUR 60k and all five
// frontier cars between EUR 23k and EUR 48k -- the band the answer is in got about 80 px of a 325 px
// plot on a phone, and 32 of 55 markers there overlapped another. On a log axis equal ratios sit at
// equal distances, which is how a buyer weighs price: 25k to 30k gets the room 125k to 150k gets. No
// item is dropped, and the frontier is still a step.
//
// `priceScale` is the one transform from a price to an x. Markers, gridlines and ticks, the frontier
// step line (built from marker positions), the price-range whisker and the nearest-point hit test
// (which works on marker positions) all go through it, so nothing can draw on a linear axis by
// accident.
export function priceScale(domain, left, right) {
  const [lo, hi] = domain;
  const a = Math.log(lo);
  const b = Math.log(hi);
  const toX = (price) =>
    b > a ? left + ((Math.log(price) - a) / (b - a)) * (right - left) : (left + right) / 2;
  return { kind: 'log', domain: [lo, hi], left, right, toX };
}

// Round prices for the ends of the axis and for its ticks, per power of ten.
const LOG_END_MANTISSAS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
const LOG_TICK_MANTISSAS = [1, 1.5, 2, 3, 5, 8];
function ladder(mantissas, lo, hi) {
  const out = [];
  for (let power = Math.floor(Math.log10(lo)) - 1; 10 ** power <= hi * 10; power += 1)
    for (const mantissa of mantissas) out.push(Math.round(mantissa * 10 ** power));
  return out.sort((a, b) => a - b);
}

// The fitted domain, in the scale it is drawn in. `niceDomain` fits it and its numbers are kept
// wherever a log axis can use them. Two cases cannot be kept as they are. A lower bound of zero has
// no logarithm. And `niceDomain`'s own rule, that neither end pads the axis by more than a quarter of
// the data's span, measured in currency, is broken when the same end is measured in ratios: a 10k
// floor would leave a third of a log axis empty below an 18k cheapest item. Such an end moves to the
// nearest round price that still contains every item, and no further.
export function logPriceDomain(prices = [], count = 5) {
  const [fittedLo, fittedHi] = niceDomain(prices, count, true);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.log(max) - Math.log(min);
  const overpadded = (gap) => span > 0 && gap > span * 0.25;
  const ends = ladder(LOG_END_MANTISSAS, min, max);
  let lo = fittedLo;
  let hi = fittedHi;
  if (!(lo > 0) || overpadded(Math.log(min) - Math.log(lo)))
    lo = ends.filter((value) => value <= min).at(-1) ?? min;
  if (overpadded(Math.log(hi) - Math.log(max))) hi = ends.find((value) => value >= max) ?? max;
  return [lo, hi];
}

// Ticks at round prices, never closer than `minimumGap` units on the axis. Both ends are always
// ticks, as they are on the linear axis, so the axis says where it starts and stops; an interior
// tick that would crowd the last one gives way to it.
export function logPriceTicks(axis, minimumGap = 64) {
  const [lo, hi] = axis.domain;
  if (!(hi > lo)) return [lo];
  const kept = [lo];
  for (const value of ladder(LOG_TICK_MANTISSAS, lo, hi))
    if (value > lo && value < hi && axis.toX(value) - axis.toX(kept.at(-1)) >= minimumGap) kept.push(value);
  while (kept.length > 1 && axis.toX(hi) - axis.toX(kept.at(-1)) < minimumGap) kept.pop();
  kept.push(hi);
  return kept;
}

// The step line through the frontier, in data coordinates: the highest score available at each
// budget, holding each frontier item's score until the next one takes over, and running on to the
// right edge of the domain.
export function budgetStepCoordinates(frontier, xDomainMaximum) {
  if (!frontier.length) return [];
  const scoreOf = (item) => item.score ?? item.metricScore;
  const pts = [{ price: frontier[0].purchasePrice, score: scoreOf(frontier[0]) }];
  for (let i = 1; i < frontier.length; i++) {
    pts.push({ price: frontier[i].purchasePrice, score: scoreOf(frontier[i - 1]) });
    pts.push({ price: frontier[i].purchasePrice, score: scoreOf(frontier[i]) });
  }
  pts.push({ price: xDomainMaximum, score: scoreOf(frontier.at(-1)) });
  return pts;
}
