// The chart's sample and its zoom (browser/sampling.js), ported from Whichcar's tests with items in
// place of cars. The defects they prevent are the ones a sample and a zoom can introduce: an item the
// page names in words drawn as an anonymous dot, a sample that reshuffles on every render, a zoom that
// prints one range and draws another, and a "not zoomed" state with two spellings.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MIN_ZOOM_RATIO,
  clampPriceZoom,
  configureZoom,
  zoomUnit,
  priceAtX,
  sampleChartItems,
  samplePerSlice,
  zoomPriceDomain,
  zoomPriceTicks,
} from '../browser/sampling.js';
import { priceScale } from '../browser/scales.js';

const item = (id, x, metricScore, extra = {}) => ({ id, name: id, x, y: 400 - metricScore * 3, metricScore, purchasePrice: x * 100, ...extra });
// Forty items across a 1,000-wide plot, four to a 100-unit slice, the best of each slice known.
const crowd = Array.from({ length: 40 }, (_, i) => item(`c${i}`, 10 + i * 25, 50 + ((i * 7) % 23)));
const options = { left: 0, right: 1000, sliceWidth: 100, minGap: 20 };

describe('sampleChartItems picks which items a crowded chart draws at full size', () => {
  it('names one item per price slice, the highest scoring in it', () => {
    const shown = sampleChartItems(crowd, options);
    assert.equal(shown.size, 10);
    for (let slice = 0; slice < 10; slice += 1) {
      const inSlice = crowd.filter((c) => Math.floor(c.x / 100) === slice);
      const best = inSlice.reduce((a, b) => (b.metricScore > a.metricScore ? b : a));
      assert.ok(shown.has(best.id), `slice ${slice} shows ${best.id}`);
    }
  });

  // An item the card, the shortlist or the frontier line names must never be an anonymous dot: that is
  // the Whichcar report of an unlabelled car read as a missing one. The sample may add to the always-set and never takes from it, even when
  // two always-shown items sit on top of each other.
  it('never drops an item the page is already talking about', () => {
    const always = ['c1', 'c2', 'c17'];
    const shown = sampleChartItems(crowd, { ...options, always });
    for (const id of always) assert.ok(shown.has(id), id);
    const stacked = [item('a', 100, 70), item('b', 101, 70), ...crowd];
    const both = sampleChartItems(stacked, { ...options, always: ['a', 'b'] });
    assert.ok(both.has('a') && both.has('b'));
  });

  // A sample that depended on input order would reshuffle the named items every time a slider
  // re-sorted the list, and the chart would flicker under the visitor's hand.
  it('gives the same sample whatever order the items arrive in, breaking score ties by price then name', () => {
    const tied = [item('zeta', 110, 70, { purchasePrice: 30000 }), item('alpha', 150, 70, { purchasePrice: 30000 }), item('dear', 130, 70, { purchasePrice: 31000 })];
    const forwards = sampleChartItems([...tied, ...crowd.slice(8)], options);
    const backwards = sampleChartItems([...crowd.slice(8), ...tied].reverse(), options);
    assert.deepEqual([...forwards].sort(), [...backwards].sort());
    assert.ok(forwards.has('alpha') && !forwards.has('zeta') && !forwards.has('dear'));
  });

  it('leaves an item small when its marker would sit on one already shown', () => {
    const shown = sampleChartItems([item('kept', 95, 80), item('near', 105, 79), item('low', 150, 60)], { ...options, always: ['kept'] });
    // `near` is the best of the second slice but 10 units from `kept`; the slice falls to `low`.
    assert.deepEqual([...shown].sort(), ['kept', 'low']);
  });

  // Sampling a dozen items hides some of them for nothing: there was no clutter to cure.
  it('shows every item when few enough are in view', () => {
    const few = crowd.slice(0, 12);
    assert.equal(sampleChartItems(few, { ...options, showAllUpTo: 12 }).size, 12);
    assert.ok(sampleChartItems(few, { ...options, showAllUpTo: 11 }).size < 12);
  });

  // Zooming is what reveals the rest: the same items spread over a wider plot fill more slices.
  it('names more items once the same items are spread across a zoomed axis', () => {
    const tight = crowd.map((c) => ({ ...c, x: c.x / 4 }));
    assert.ok(sampleChartItems(crowd, options).size > sampleChartItems(tight, options).size);
  });

  // The number of slices is the width of the plot, which a zoom does not change, so with one item a
  // slice a zoom named fewer items than the full view did: 18, then 16, then 15 on the default view of
  // 21 November 2026. A zoomed chart lets each slice name more, still never two on top of each other.
  it('lets a slice name more than one item when zoomed, in score order and never overlapping', () => {
    const column = [item('top', 50, 80), item('second', 52, 70), item('third', 54, 60), item('beside-top', 55, 79)];
    assert.deepEqual([...sampleChartItems(column, options)], ['top']);
    assert.deepEqual([...sampleChartItems(column, { ...options, perSlice: 2 })].sort(), ['second', 'top']);
    // `beside-top` outscores `second` but would sit on `top`, so it stays small at any quota.
    assert.deepEqual([...sampleChartItems(column, { ...options, perSlice: 9 })].sort(), ['second', 'third', 'top']);
    assert.deepEqual([...sampleChartItems(column, { ...options, perSlice: NaN })], ['top']);
  });

  // An item without a position (price pending) cannot be placed, so it cannot claim a slice.
  it('ignores an item with no position instead of placing it at zero', () => {
    const shown = sampleChartItems([item('ghost', NaN, 99), item('real', 50, 60)], options);
    assert.deepEqual([...shown], ['real']);
  });
});

describe('samplePerSlice says how many items a slice may name at a zoom', () => {
  const full = [20000, 200000];
  it('is one on the full range and when there is no zoom to measure', () => {
    assert.equal(samplePerSlice(full, full), 1);
    assert.equal(samplePerSlice(null, full), 1);
    assert.equal(samplePerSlice([30000, 40000], null), 1);
  });
  // Measured as ratios, because the axis is a log one: 20k-200k holds 63k-200k twice, though in
  // euros the second range is three quarters of the first.
  it('grows by one each time the range in view fits again into the full one', () => {
    assert.equal(samplePerSlice([63246, 200000], full), 2);
    assert.equal(samplePerSlice([40000, 86177], full), 3);
    assert.ok(samplePerSlice([50000, 56000], full) > 10);
  });
});

describe('clampPriceZoom makes a requested price range safe to draw', () => {
  const full = [20000, 200000];
  // Null is the only spelling of "not zoomed". A range equal to the full one stored as a zoom left
  // "Show all" enabled over a chart that was already showing everything.
  it('answers null for the full range, a wider one, or a malformed one', () => {
    assert.equal(clampPriceZoom(full, full), null);
    assert.equal(clampPriceZoom([1000, 900000], full), null);
    assert.equal(clampPriceZoom([50000, 40000], full), null);
    assert.equal(clampPriceZoom([0, 40000], full), null);
    assert.equal(clampPriceZoom([NaN, 40000], full), null);
    assert.equal(clampPriceZoom(null, full), null);
    assert.equal(clampPriceZoom([30000, 40000], null), null);
  });

  // A zoom from 38,512 printed its first tick as "€39k" and drew an item to the left of it.
  it('snaps both ends outwards to whole thousands, so the printed ends are the drawn ends', () => {
    assert.deepEqual(clampPriceZoom([38512, 51377], full), [38000, 52000]);
  });

  it('slides a range that overhangs an end back inside without narrowing it', () => {
    const [lo, hi] = clampPriceZoom([15000, 30000], full);
    assert.equal(lo, 20000);
    assert.ok(hi >= 39000 && hi <= 41000, String(hi));
    const top = clampPriceZoom([150000, 300000], full);
    assert.equal(top[1], 200000);
    assert.ok(top[0] <= 100000);
  });

  // Narrower than this and two items a few hundred euros apart fill the plot, on indicative prices.
  it('never zooms tighter than the minimum ratio', () => {
    const [lo, hi] = clampPriceZoom([50000, 50100], full);
    assert.ok(hi / lo >= MIN_ZOOM_RATIO, `${lo}..${hi}`);
    assert.ok(lo <= 50000 && hi >= 50100);
  });
});

describe('zoomPriceDomain zooms about a price', () => {
  const full = [20000, 200000];
  it('narrows from the full range and widens back out to null', () => {
    const inOnce = zoomPriceDomain(null, full, 0.6);
    assert.ok(inOnce[0] > full[0] && inOnce[1] < full[1]);
    assert.equal(zoomPriceDomain(inOnce, full, 10), null);
  });

  // The axis is a log one. A zoom worked in euros slid the cheap end off the plot: the middle of
  // 20k-200k in euros is 110k, and most of the catalogue is under 60k.
  it('keeps the middle of a log axis in the middle', () => {
    const [lo, hi] = zoomPriceDomain(null, full, 0.5);
    const middle = Math.sqrt(full[0] * full[1]);
    assert.ok(Math.abs(Math.sqrt(lo * hi) / middle - 1) < 0.03, `${lo}..${hi}`);
  });

  it('keeps the price under the pointer inside the new range, nearer the end it was nearer', () => {
    const [lo, hi] = zoomPriceDomain(null, full, 0.5, 30000);
    assert.ok(lo <= 30000 && hi >= 30000);
    assert.ok(Math.log(30000 / lo) < Math.log(hi / 30000));
  });

  it('refuses a factor that is not a positive number', () => {
    assert.equal(zoomPriceDomain(null, full, 0), null);
    assert.equal(zoomPriceDomain(null, full, NaN), null);
  });
});

describe('priceAtX reads a price back off the axis', () => {
  const domain = [20000, 200000];
  const scale = priceScale(domain, 60, 960);
  const axis = { domain, left: 60, right: 960 };
  // The drag and the pinch turn pointer positions into prices. An inverse that disagreed with the
  // scale would zoom to a range beside the one the visitor dragged across.
  it('is the inverse of the scale that drew the axis', () => {
    for (const price of [20000, 31000, 64000, 200000]) assert.ok(Math.abs(priceAtX(axis, scale.toX(price)) / price - 1) < 1e-9);
  });
  it('clamps a pointer outside the plot to the nearest end', () => {
    assert.ok(Math.abs(priceAtX(axis, -500) - 20000) < 1e-6);
    assert.ok(Math.abs(priceAtX(axis, 5000) - 200000) < 1e-6);
  });
  it('answers null without a usable axis rather than a price of zero', () => {
    assert.equal(priceAtX(null, 100), null);
    assert.equal(priceAtX({ domain: [0, 10], left: 0, right: 10 }, 5), null);
    assert.equal(priceAtX({ domain, left: 10, right: 10 }, 5), null);
  });
});

describe('zoomPriceTicks labels a zoomed axis', () => {
  const axisFor = (domain, left = 60, right = 960) => ({ domain, toX: priceScale(domain, left, right).toX });
  // The unzoomed ladder (1-1.5-2-3-5-8) put no tick at all inside EUR 33k-52k, so a zoomed chart had
  // an axis with two numbers on it.
  it('gives a narrow range even round steps between its two ends', () => {
    const ticks = zoomPriceTicks(axisFor([33000, 52000]));
    assert.equal(ticks[0], 33000);
    assert.equal(ticks.at(-1), 52000);
    assert.ok(ticks.length >= 5, ticks.join());
    for (const tick of ticks.slice(1, -1)) assert.equal(tick % 1000, 0);
  });
  it('keeps every label clear of its neighbour, on a phone-width axis too', () => {
    for (const [domain, left, right, gap] of [[[33000, 52000], 60, 960, 64], [[33000, 52000], 40, 370, 48], [[20000, 200000], 40, 370, 48]]) {
      const axis = axisFor(domain, left, right);
      const ticks = zoomPriceTicks(axis, gap);
      ticks.forEach((tick, i) => i && assert.ok(axis.toX(tick) - axis.toX(ticks[i - 1]) >= gap - 1e-9, ticks.join()));
      assert.equal(ticks[0], domain[0]);
      assert.equal(ticks.at(-1), domain[1]);
    }
  });
});

// Codex review on #2: the ends snapped to whole thousands, which suits SUVs and nothing cheaper. On a
// range of 300 to 900 every zoom snapped back to the full range and was refused as "not a zoom", so a
// catalogue of phones could not zoom at all.
describe('the zoom unit follows the prices in range, unless the instance sets one', () => {
  it('lets a range of a few hundred zoom, with ends and ticks in round tens', () => {
    assert.equal(zoomUnit([300, 900]), 10);
    assert.deepEqual(clampPriceZoom([500, 700], [300, 900]), [500, 700]);
    assert.deepEqual(clampPriceZoom([503.4, 698.2], [300, 900]), [500, 700]);
    assert.ok(zoomPriceDomain(null, [300, 900], 0.5));
    const axis = priceScale([500, 700], 0, 1000);
    const ticks = zoomPriceTicks(axis, 64);
    assert.ok(ticks.length > 2 && ticks.every((value) => value % 10 === 0), JSON.stringify(ticks));
  });
  it('keeps whole thousands for prices in the tens of thousands', () => assert.equal(zoomUnit([15000, 160000]), 1000));
  it('uses the unit an instance configures, whatever the range, until it is cleared', () => {
    configureZoom({ unit: 1000 });
    try {
      assert.equal(zoomUnit([300, 900]), 1000);
      assert.equal(zoomUnit([150000, 400000]), 1000);
    } finally {
      configureZoom();
    }
    assert.equal(zoomUnit([150000, 400000]), 10000);
  });
});
