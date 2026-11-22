// Which items a crowded price-against-score chart draws at full size, and the price range it is zoomed
// to. Ported from Whichcar (22 November 2026), where the default view drew 84 full-size markers and
// the owner's reading of the page was "confusing" and "cluttered". Pure functions over what the chart
// has already placed: nothing here reads the page, a score's definition or the catalogue.
//
// A marker is still drawn for every item, because an item missing from the plot reads as an item
// missing from the catalogue (an item was reported missing from Whichcar in October 2026 when it was
// only unlabelled). What changes is how many are drawn at full size: the items the answer is made of,
// and one per slice of the price axis, with the rest drawn small until the visitor zooms in and the
// slices narrow. The sentence under the chart that counts them is the instance's: it names the item.

// Width of one price slice, in the chart's own units (its viewBox is 1,000 wide on a desktop and 390
// on a phone), and how close two full-size markers may sit before the second stays small.
export const SAMPLE_SLICE_WIDTH = { wide: 62, narrow: 46 };
export const SAMPLE_MIN_GAP = { wide: 20, narrow: 17 };
// At or under this many items in view, every one is drawn at full size.
export const SAMPLE_SHOW_ALL = { wide: 24, narrow: 14 };

// The ids drawn at full size. `always` is every item the page is already talking about (best at its
// price, the two picks, the shortlist, a selected or searched-for item): the sample may add to that
// set and never takes from it. Then each slice of the axis contributes its highest-scoring item that
// is not already shown and does not sit on top of one that is. Ties go to the cheaper item and then
// to the name, so the same items and the same axis always give the same sample: a sample that
// reshuffled on every render would make the chart flicker under a slider.
export function sampleChartItems(
  plotted = [],
  { left = 0, right = 0, sliceWidth = 62, minGap = 20, always = [], showAllUpTo = 0, perSlice = 1 } = {},
) {
  // Few enough to read as they are: sampling a dozen items hides some for nothing.
  if (plotted.length <= showAllUpTo) return new Set(plotted.map((item) => item.id));
  const keep = new Set(always);
  const shown = new Set(plotted.filter((item) => keep.has(item.id)).map((item) => item.id));
  const placed = plotted.filter((item) => shown.has(item.id));
  const width = right - left;
  if (!(width > 0) || !(sliceWidth > 0)) return shown;
  const slices = Math.max(1, Math.floor(width / sliceWidth));
  const sliceOf = (item) => Math.min(slices - 1, Math.max(0, Math.floor(((item.x - left) / width) * slices)));
  const order = (a, b) =>
    b.metricScore - a.metricScore ||
    a.purchasePrice - b.purchasePrice ||
    String(a.name).localeCompare(String(b.name));
  const bySlice = new Map();
  for (const item of plotted) {
    if (shown.has(item.id) || !Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
    const slice = sliceOf(item);
    if (!bySlice.has(slice)) bySlice.set(slice, []);
    bySlice.get(slice).push(item);
  }
  const quota = Math.max(1, Math.floor(perSlice) || 1);
  for (let slice = 0; slice < slices; slice += 1) {
    let taken = 0;
    for (const candidate of (bySlice.get(slice) ?? []).sort(order)) {
      if (taken >= quota) break;
      if (placed.some((other) => Math.hypot(other.x - candidate.x, other.y - candidate.y) < minGap)) continue;
      shown.add(candidate.id);
      placed.push(candidate);
      taken += 1;
    }
  }
  return shown;
}

// How many items one slice may name at a given zoom: one on the full range, and one more for each
// time the range in view fits again into the full one (both measured as ratios, because the axis is
// a log one). Without it a zoom named fewer items, not more: the number of slices is the width of the
// plot, which does not change, so on the default view the 18 items named on the full range became 16
// and then 15 as the visitor zoomed into the densest band, the opposite of what zooming is for.
export function samplePerSlice(view, full) {
  if (!validDomain(view) || !validDomain(full)) return 1;
  const share = Math.log(full[1] / full[0]) / Math.log(view[1] / view[0]);
  return Number.isFinite(share) ? Math.max(1, Math.round(share)) : 1;
}

// The narrowest range the chart zooms to: one end 12% above the other. Narrower than that and two
// items a few hundred euros apart fill the plot, on prices the page itself calls indicative.
export const MIN_ZOOM_RATIO = 1.12;
const sameDomain = (a, b) => Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) < 1;
const validDomain = (domain) =>
  Array.isArray(domain) &&
  domain.length === 2 &&
  domain.every((v) => Number.isFinite(v) && v > 0) &&
  domain[1] > domain[0];

// A requested range made safe to draw: inside the full range, no narrower than the minimum, and
// `null` when it is not a zoom at all. Null is the only spelling of "not zoomed", so a range that
// has drifted back to the full one cannot leave the Reset button enabled over an unzoomed chart.
export function clampPriceZoom(requested, full) {
  if (!validDomain(full) || !validDomain(requested)) return null;
  const a = Math.log(full[0]);
  const b = Math.log(full[1]);
  const minSpan = Math.min(Math.log(MIN_ZOOM_RATIO), b - a);
  let lo = Math.log(requested[0]);
  let hi = Math.log(requested[1]);
  if (hi - lo < minSpan) {
    const centre = (lo + hi) / 2;
    lo = centre - minSpan / 2;
    hi = centre + minSpan / 2;
  }
  if (lo < a) {
    hi += a - lo;
    lo = a;
  }
  if (hi > b) {
    lo -= hi - b;
    hi = b;
  }
  lo = Math.max(lo, a);
  // Whole thousands, widened never narrowed, so the ends the axis prints ("€39k") are the ends it
  // draws: a range from 38,512 printed as €39k put an item on the plot to the left of the first tick.
  const domain = [
    Math.max(full[0], Math.floor(Math.exp(lo) / 1000 + 1e-9) * 1000),
    Math.min(full[1], Math.ceil(Math.exp(hi) / 1000 - 1e-9) * 1000),
  ];
  if (!(domain[1] > domain[0])) return null;
  return sameDomain(domain, full) ? null : domain;
}

// Zoom by a factor about a price: under 1 narrows the range, over 1 widens it, and the price under
// the pointer (or the middle of the view) keeps its place on the axis. Worked in log space, because
// the axis is a log one and a zoom that is even in euros slides the cheap end off the plot.
export function zoomPriceDomain(current, full, factor, centrePrice = null) {
  const from = validDomain(current) ? current : full;
  if (!validDomain(from) || !validDomain(full) || !(factor > 0)) return null;
  const lo = Math.log(from[0]);
  const hi = Math.log(from[1]);
  const centre = Number.isFinite(centrePrice) && centrePrice > 0 ? Math.log(centrePrice) : (lo + hi) / 2;
  const at = Math.min(hi, Math.max(lo, centre));
  return clampPriceZoom([Math.exp(at - (at - lo) * factor), Math.exp(at + (hi - at) * factor)], full);
}

// The price at a position on a log axis: the inverse of `priceScale(...).toX`.
export function priceAtX(axis, x) {
  if (!axis || !validDomain(axis.domain) || !(axis.right > axis.left)) return null;
  const share = Math.min(1, Math.max(0, (x - axis.left) / (axis.right - axis.left)));
  const lo = Math.log(axis.domain[0]);
  const hi = Math.log(axis.domain[1]);
  return Math.exp(lo + share * (hi - lo));
}

// Ticks for a zoomed axis. The unzoomed axis takes its ticks from a 1-1.5-2-3-5-8 ladder, which puts
// one tick, or none, inside a range like EUR 33k to 52k. A zoomed range is narrow enough to read in
// even euro steps, so it gets the smallest round step whose labels still clear each other, plus its
// two ends.
const ZOOM_TICK_STEPS = [1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000];
export function zoomPriceTicks(axis, minimumGap = 64) {
  const [lo, hi] = axis.domain;
  if (!(hi > lo)) return [lo];
  for (const step of ZOOM_TICK_STEPS) {
    const inner = [];
    for (let value = Math.ceil(lo / step) * step; value < hi; value += step)
      if (value > lo) inner.push(value);
    const kept = [lo, ...inner, hi];
    const clear = kept.every((value, i) => i === 0 || axis.toX(value) - axis.toX(kept[i - 1]) >= minimumGap);
    if (clear) return kept;
    // The ends are the range itself and always stay; an inner tick crowding one of them goes.
    const trimmed = inner.filter(
      (value) => axis.toX(value) - axis.toX(lo) >= minimumGap && axis.toX(hi) - axis.toX(value) >= minimumGap,
    );
    const spaced = trimmed.every(
      (value, i) => i === 0 || axis.toX(value) - axis.toX(trimmed[i - 1]) >= minimumGap,
    );
    if (trimmed.length && spaced) return [lo, ...trimmed, hi];
  }
  return [lo, hi];
}
