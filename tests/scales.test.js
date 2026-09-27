import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { budgetStepCoordinates, logPriceDomain, logPriceTicks, niceDomain, niceStep, previousNiceStep, priceScale, scale, ticks } from '../browser/scales.js';

describe('linear scale and tick steps', () => {
  it('maps a value between two ranges and centres a degenerate domain', () => {
    assert.equal(scale(5, 0, 10, 0, 100), 50);
    assert.equal(scale(5, 5, 5, 0, 100), 50);
  });
  it('rounds a raw step up to 1, 2, 5 or 10 times a power of ten, and steps back down the same ladder', () => {
    assert.deepEqual([1.3, 2, 3, 7, 12].map(niceStep), [2, 2, 5, 10, 20]);
    assert.deepEqual([10, 5, 2, 1].map(previousNiceStep), [5, 2, 1, 0.5]);
  });
  it('lists the ticks of a domain without accumulating float error', () => {
    assert.deepEqual(ticks([0, 1, 0.1]).length, 11);
    assert.deepEqual(ticks([20000, 60000, 10000]), [20000, 30000, 40000, 50000, 60000]);
  });
});

// A coarse tick step can round the domain out far beyond the data: at three ticks a 23k-68k spread
// became a 0-100k axis that squashed every point into one corner.
describe('niceDomain keeps the axis close to the data', () => {
  const padding = ([lo, hi], vals) => {
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min;
    return Math.max(min - lo, hi - max) / span;
  };
  it('pads neither end by more than a quarter of the span, on the spreads that once did', () => {
    for (const vals of [
      [23000, 68000],
      [23000, 92000],
      [23400, 152474],
      [36500, 70841],
    ]) {
      const domain = niceDomain(vals, 3, true);
      assert.ok(padding(domain, vals) <= 0.25, `${vals}: ${domain}`);
      assert.ok(domain[0] <= Math.min(...vals) && domain[1] >= Math.max(...vals));
    }
  });
  it('never carries more than ten ticks', () => {
    for (let count = 2; count <= 8; count += 1) {
      const [lo, hi, step] = niceDomain([23000, 152474], count, true);
      assert.ok((hi - lo) / step + 1 <= 10);
    }
  });
  it('contains every value and reports a positive step', () => {
    const [lo, hi, step] = niceDomain([48, 52, 61], 5);
    assert.ok(lo <= 48 && hi >= 61 && step > 0);
  });
});

describe('the logarithmic price axis', () => {
  it('places equal ratios at equal distances', () => {
    const axis = priceScale([10000, 160000], 0, 400);
    assert.equal(axis.kind, 'log');
    assert.equal(Math.round(axis.toX(40000) - axis.toX(20000)), Math.round(axis.toX(80000) - axis.toX(40000)));
    assert.equal(axis.toX(10000), 0);
    assert.equal(axis.toX(160000), 400);
  });
  it('centres a domain with no width rather than dividing by zero', () => {
    assert.equal(priceScale([100, 100], 0, 400).toX(100), 200);
  });
  // A lower bound of zero has no logarithm, and an end that pads the axis by more than a quarter of
  // the span in ratios moves to the nearest round price that still contains every item.
  it('moves an unusable fitted end to a round price that still contains every item', () => {
    const [lo, hi] = logPriceDomain([18000, 95000], 5);
    assert.ok(lo > 0 && lo <= 18000, `${lo}`);
    assert.ok(hi >= 95000, `${hi}`);
    const spanRatio = Math.log(95000) - Math.log(18000);
    assert.ok(Math.log(18000) - Math.log(lo) <= spanRatio * 0.25 + 1e-9);
    assert.ok(Math.log(hi) - Math.log(95000) <= spanRatio * 0.25 + 1e-9);
  });
  it('keeps both ends as ticks and never crowds two closer than the minimum gap', () => {
    const axis = priceScale(logPriceDomain([18000, 95000], 5), 0, 500);
    const marks = logPriceTicks(axis, 64);
    assert.equal(marks[0], axis.domain[0]);
    assert.equal(marks.at(-1), axis.domain[1]);
    for (let i = 1; i < marks.length; i += 1) assert.ok(axis.toX(marks[i]) - axis.toX(marks[i - 1]) >= 64 - 1e-9, `${marks}`);
  });
  it('answers a single tick for a domain with no width', () => {
    assert.deepEqual(logPriceTicks(priceScale([100, 100], 0, 500)), [100]);
  });
});

describe('budgetStepCoordinates', () => {
  it('holds each frontier score until the next item takes over, and runs to the right edge', () => {
    const frontier = [
      { purchasePrice: 10, score: 50 },
      { purchasePrice: 20, metricScore: 70 },
    ];
    assert.deepEqual(budgetStepCoordinates(frontier, 30), [
      { price: 10, score: 50 },
      { price: 20, score: 50 },
      { price: 20, score: 70 },
      { price: 30, score: 70 },
    ]);
  });
  it('draws nothing for an empty frontier', () => assert.deepEqual(budgetStepCoordinates([], 30), []));
});
