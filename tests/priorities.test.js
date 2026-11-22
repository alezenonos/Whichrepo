// Priorities stated as an order or as levels, turned into whole percentages (browser/priorities.js).
// Ported from Whichcar's tests of the same rules (#183, #222 and the importance levels of 21 October
// 2026), with phones in place of cars. The defects they prevent: percentages that do not total 100
// (the scorer refuses them); a lower place or level given more than a higher one by rounding; two
// priorities called equal given different percentages when the total allowed equal ones; and a
// ranking or set of levels lost on reload, because a page saves the weights and nothing else.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IMPORTANCE_LEVEL_WEIGHTS, createPriorityModel, rankOrderCentroid } from '../browser/priorities.js';
import { createWeightModel } from '../browser/weights.js';

const KEYS = ['camera', 'battery', 'screen', 'build', 'speed', 'storage', 'size', 'support', 'audio', 'charging'];
const DIMENSIONS = KEYS.map((key) => ({ key, ratingKey: key, label: key, defaultWeight: 10 }));
const { validPercentWeights, DEFAULT_WEIGHTS } = createWeightModel({ dimensions: DIMENSIONS });
const { rankingWeights, rankingFromWeights, levelWeights, levelsFromWeights } = createPriorityModel({
  dimensions: DIMENSIONS,
});
const none = Object.fromEntries(KEYS.map((key) => [key, 0]));
const nonzero = (weights) => Object.fromEntries(Object.entries(weights).filter(([, value]) => value));
// A seeded generator, so a failure names a ranking that can be replayed.
function random(seed) {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
}
function randomRankings(count, seed = 183) {
  const next = random(seed);
  const out = [];
  while (out.length < count) {
    const ranking = {};
    for (const key of KEYS) if (next() < 0.6) ranking[key] = 1 + Math.floor(next() * 5);
    if (Object.keys(ranking).length) out.push(ranking);
  }
  return out;
}

describe('rankOrderCentroid, the published rule a ranking becomes percentages by', () => {
  it('gives the shares Barron and Barrett tabulate', () => {
    assert.deepEqual(rankOrderCentroid(1), [1]);
    assert.deepEqual(rankOrderCentroid(2), [0.75, 0.25]);
    assert.deepEqual(
      rankOrderCentroid(3).map((x) => x.toFixed(4)),
      ['0.6111', '0.2778', '0.1111'],
    );
  });
  it('sums to one and falls with every place', () => {
    for (let k = 1; k <= 10; k += 1) {
      const shares = rankOrderCentroid(k);
      assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 1) < 1e-12, `k=${k}`);
      for (let i = 1; i < k; i += 1) assert.ok(shares[i] < shares[i - 1], `k=${k} place ${i + 1}`);
    }
  });
  it('has no shares for a number of priorities that is not one', () => {
    for (const k of [0, -1, 1.5, '2', null]) assert.deepEqual(rankOrderCentroid(k), []);
  });
});

describe('rankingWeights', () => {
  it('turns "camera, then battery" into 75% and 25%, and nothing elsewhere', () =>
    assert.deepEqual(nonzero(rankingWeights({ camera: 1, battery: 2 })), { camera: 75, battery: 25 }));
  it('rounds three places to whole percentages that total 100', () =>
    assert.deepEqual(nonzero(rankingWeights({ camera: 1, battery: 2, screen: 3 })), {
      camera: 61,
      battery: 28,
      screen: 11,
    }));
  // Largest remainder alone gave 45/44/11: two priorities the visitor called equal, a point apart.
  it('keeps two priorities ranked equal at equal percentages when the total allows it', () =>
    assert.deepEqual(nonzero(rankingWeights({ camera: 1, battery: 1, screen: 2 })), {
      camera: 44,
      battery: 44,
      screen: 12,
    }));
  it('gives the extra point to one of a group only when no whole group can take it', () => {
    const nine = rankingWeights(Object.fromEntries(KEYS.slice(0, 9).map((key) => [key, 1])));
    assert.deepEqual(
      Object.values(nine)
        .filter((weight) => weight > 0)
        .sort((a, b) => a - b),
      [11, 11, 11, 11, 11, 11, 11, 11, 12],
    );
  });
  it('reads places as an order, so a gap closes up', () =>
    assert.deepEqual(rankingWeights({ camera: 1, battery: 3 }), rankingWeights({ camera: 1, battery: 2 })));
  it('ignores a place that is not a whole number from 1, and has no weights for an empty ranking', () => {
    assert.deepEqual(
      rankingWeights({ camera: 1, battery: 0, screen: -1, build: 1.5, speed: '2', storage: null }),
      rankingWeights({ camera: 1 }),
    );
    assert.equal(rankingWeights({}), null);
    assert.equal(rankingWeights(null), null);
  });
  const rankings = randomRankings(2000);
  // A ranked priority has to count for something, and a better place never for less.
  it('always gives an allocation the scorer accepts, with no ranked priority at 0%', () => {
    for (const ranking of rankings) {
      const weights = rankingWeights(ranking);
      assert.ok(validPercentWeights(weights), JSON.stringify(ranking));
      for (const [key, place] of Object.entries(ranking)) {
        assert.ok(weights[key] >= 1, `${key} ranked ${place} got 0%`);
        for (const [other, otherPlace] of Object.entries(ranking))
          if (place < otherPlace) assert.ok(weights[key] >= weights[other], JSON.stringify(ranking));
      }
    }
  });
});

describe('rankingFromWeights reads a ranking back from the weights, and only an exact one', () => {
  it('reads back a ranking that reproduces every set of weights a ranking produced', () => {
    for (const ranking of randomRankings(1000, 7)) {
      const weights = rankingWeights(ranking);
      assert.deepEqual(rankingWeights(rankingFromWeights(weights)), weights, JSON.stringify(ranking));
    }
  });
  // One slider step and the controls must say "set by hand", not claim a ranking that is not there.
  it('claims no ranking once a slider has moved a point', () => {
    const weights = rankingWeights({ camera: 1, battery: 2 });
    assert.equal(rankingFromWeights({ ...weights, camera: 74, screen: 1 }), null);
  });
  it('refuses an allocation the scorer would refuse', () => {
    assert.equal(rankingFromWeights({}), null);
    assert.equal(rankingFromWeights({ ...rankingWeights({ camera: 1 }), battery: 5 }), null);
    // Absence is not zero: a missing weight is not read as a priority set to 0%.
    assert.equal(rankingFromWeights({ ...rankingWeights({ camera: 1 }), battery: null }), null);
  });
});

describe('importance levels', () => {
  it('are fixed multiples, 9 : 2 : 1', () => assert.deepEqual([...IMPORTANCE_LEVEL_WEIGHTS], [0, 1, 2, 9]));
  // Whichcar's report of 21 October 2026: a priority raised to Matters most carried 24% as a place
  // in a ranking, and barely moved the chart. As a multiple, beside nine at Matters, it carries about
  // a third; beside nine at Matters a little, half.
  it('give one priority at Matters most a share that moves the answer', () => {
    const beside = (level) => levelWeights({ ...Object.fromEntries(KEYS.map((key) => [key, level])), camera: 3 });
    // 9 parts of 27 is 33.3%: the camera's group takes one leftover point whole, and the nine at
    // Matters, too many to share the other three equally, give them to the first three declared.
    assert.deepEqual(beside(2), {
      ...Object.fromEntries(KEYS.map((key) => [key, 7])),
      camera: 34,
      battery: 8,
      screen: 8,
      build: 8,
    });
    // Exactly 50% before rounding, and 51% after: whole groups take leftover points before single
    // members, so the camera's group of one takes a point the nine cannot share equally. That is the
    // rule as Whichcar shipped it, pinned so a change to it shows up as a reviewed diff.
    assert.equal(beside(1).camera, 51);
  });
  it('keep gaps: Matters most beside Matters a little is not first beside second', () =>
    assert.deepEqual(nonzero(levelWeights({ ...none, camera: 3, battery: 1 })), { camera: 90, battery: 10 }));
  it('count nothing when nothing is counted', () => {
    assert.equal(levelWeights(none), null);
    assert.equal(levelWeights({}), null);
  });
  it('turn any set of levels into whole percentages the scorer accepts, read back exactly', () => {
    for (let trial = 0; trial < 3000; trial += 1) {
      const levels = Object.fromEntries(KEYS.map((key, i) => [key, (trial * 7 + i * i * 13 + trial * i) % 4]));
      const weights = levelWeights(levels);
      if (!KEYS.some((key) => levels[key])) continue;
      assert.ok(validPercentWeights(weights), JSON.stringify(levels));
      for (const a of KEYS)
        for (const b of KEYS) {
          if (levels[a] > levels[b]) assert.ok(weights[a] >= weights[b], `${a} below ${b}`);
          if (levels[a] === levels[b] && levels[a] > 0) assert.ok(Math.abs(weights[a] - weights[b]) <= 1);
        }
      // Whatever levels come back must give the same percentages, or a reload would move them.
      const read = levelsFromWeights(weights);
      assert.ok(read, JSON.stringify(levels));
      assert.deepEqual(levelWeights(read), weights);
    }
  });
  it('read percentages set by hand as no levels at all', () => {
    assert.equal(levelsFromWeights({ ...DEFAULT_WEIGHTS, camera: 11, battery: 9 }), null);
    assert.deepEqual(levelsFromWeights(DEFAULT_WEIGHTS), Object.fromEntries(KEYS.map((key) => [key, 3])));
  });
  // A model bound to one catalogue's dimensions still answers for another set handed to it.
  it('take another set of dimensions when given one', () => {
    const two = [{ key: 'camera' }, { key: 'battery' }];
    assert.deepEqual(levelWeights({ camera: 3, battery: 2 }, two), { camera: 82, battery: 18 });
  });
});
