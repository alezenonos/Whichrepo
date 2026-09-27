import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { correlationSignificance, finite, fitLine, groupedHoldout, inSample, leaveOneOut, midRankPercentile, pearson, quantile } from '../node/stats.mjs';

// `pearson` is the instrument a which* repository measures with before it designs. An instrument
// that answers confidently when it has been handed nonsense is worse than one that refuses.
describe('pearson refuses the inputs it cannot answer for', () => {
  // Both means were divided by `xs.length` while `ys` was summed in full, so unequal columns --
  // the shape two `.map()` calls over differently filtered catalogues produce -- returned a
  // plausible small number: a perfect r=1 over three pairs reported 0.008.
  it('refuses two columns of different lengths rather than reporting a number for them', () => {
    assert.throws(() => pearson([1, 2, 3], [2, 4, 6, 100, 200, 300]), /same length/);
    assert.throws(() => pearson([1, 2, 3, 4, 5, 6], [2, 4, 6]), /same length/);
  });
  it('returns null rather than NaN when there are too few pairs to correlate', () => {
    assert.equal(pearson([1], [2]), null);
    assert.equal(pearson([], []), null);
  });
  it('returns null when either column has no variance at all', () => {
    assert.equal(pearson([3, 3, 3], [1, 2, 3]), null);
    assert.equal(pearson([1, 2, 3], [7, 7, 7]), null);
  });
  it('still reports the correlation it was built to report', () => {
    assert.equal(pearson([1, 2, 3], [2, 4, 6]), 1);
    assert.equal(pearson([1, 2, 3], [6, 4, 2]), -1);
  });
  it('calls a strong correlation on a small sample significant and a weak one not', () => {
    assert.ok(Math.abs(correlationSignificance(0.9, 12)) > 1.96);
    assert.ok(Math.abs(correlationSignificance(0.2, 12)) < 1.96);
  });
});

// `Number(null)` is 0 and `Number.isFinite(0)` is true: 45 records with no published width once
// entered a fit at zero and reported a correlation of -0.08 for a relationship that is really 0.87.
describe('absence is not a number', () => {
  it('reads null, undefined and the empty string as absent', () => {
    for (const value of [null, undefined, '']) assert.equal(finite(value), null);
    assert.equal(finite('0'), 0);
    assert.equal(finite(' 12 '), 12);
    assert.equal(finite('twelve'), null);
  });
});

describe('midRankPercentile', () => {
  // A rating held by half the field lands mid-field rather than at an edge.
  it('gives tied values the average of the ranks they span', () => {
    const rank = midRankPercentile([2, 4, 4, 4, 4, 5]);
    assert.equal(rank(4), (1 + 3 / 2) / 5);
    assert.equal(rank(2), 0);
    assert.equal(rank(5), 1);
  });
  // One item ranked against itself has no standing -- not 0, which would read as "the worst".
  it('returns the middle for a series too short to rank', () => {
    assert.equal(midRankPercentile([7])(7), 0.5);
    assert.equal(midRankPercentile([])(7), 0.5);
  });
});

describe('least squares and the two baselines every fit is measured against', () => {
  const rows = [
    { group: 'a', x: 1, y: 2.1 },
    { group: 'a', x: 2, y: 3.9 },
    { group: 'b', x: 3, y: 6.2 },
    { group: 'b', x: 4, y: 7.8 },
    { group: 'c', x: 5, y: 10.1 },
    { group: 'c', x: 6, y: 11.9 },
  ];
  it('fits the line the data describes', () => {
    const line = fitLine(rows.map((row) => [row.x, row.y]));
    assert.ok(Math.abs(line.slope - 2) < 0.05, `${line.slope}`);
    assert.ok(line.r > 0.99);
    assert.equal(line.n, 6);
  });
  it('reports null for the correlation of a constant column rather than dividing by zero', () => {
    assert.equal(fitLine([[1, 5], [2, 5]]).r, null);
    assert.equal(fitLine([[3, 1], [3, 2]]).slope, 0);
  });
  // A group is held out whole, and a fit with real information beats predicting the mean.
  it('holds each group out whole and reports positive skill for a fit that carries information', () => {
    const held = groupedHoldout(rows, { minTrain: 2 });
    assert.equal(held.n, 6);
    assert.equal(held.groups, 3);
    assert.ok(held.mae < held.mean_only_mae);
    assert.ok(held.skill > 0.5, `${held.skill}`);
  });
  it('reports no skill for a predictor that carries none', () => {
    const noise = rows.map((row, index) => ({ ...row, y: [5, 1, 5, 1, 5, 1][index] }));
    const held = groupedHoldout(noise, { minTrain: 2 });
    assert.ok(held.skill <= 0.05, `${held.skill}`);
  });
  it('skips a group whose removal leaves too little to train on, and says how many rows it scored', () => {
    const held = groupedHoldout(rows, { minTrain: 5 });
    assert.equal(held.n, 0);
    assert.equal(held.mae, null);
  });
  // `predict`, where given, is the rule that ships -- so the thing measured is the thing published.
  it('measures the shipped predictor rather than a straight line when one is given', () => {
    const shipped = groupedHoldout(rows, { minTrain: 2, predict: () => () => 7 });
    assert.ok(shipped.mae > 2, `${shipped.mae}`);
    assert.deepEqual(leaveOneOut(rows, { predict: () => () => 7 }).mae, shipped.mae);
    assert.equal(inSample(rows, { predict: () => () => 7 }).mae, shipped.mae);
  });
  it('groups residuals by subgroup where rows carry one', () => {
    const held = groupedHoldout(rows.map((row) => ({ ...row, subgroup: row.x % 2 ? 'odd' : 'even' })), { minTrain: 2 });
    assert.deepEqual(Object.keys(held.subgroups), ['even', 'odd']);
    assert.equal(held.subgroups.even.n, 3);
  });
  it('quantile reads the empirical percentile and null for nothing', () => {
    assert.equal(quantile([5, 1, 3], 0.5), 3);
    assert.equal(quantile([], 0.5), null);
  });
});
