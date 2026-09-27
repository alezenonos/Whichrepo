// The weight model, bound to a made-up set of dimensions so nothing here depends on a catalogue:
// four sliders, one of which reads two rating keys and one of which is shrunk towards its mean.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { exceedsBand, parseFiniteNumber } from '../browser/bands.js';
import {
  createWeightModel,
  dimensionRating,
  effectiveRating,
  largestRemainderRound,
  rankTiedScores,
  ratingKeysOf,
} from '../browser/weights.js';

const DIMENSIONS = [
  { key: 'camera', ratingKey: 'camera', label: 'Camera', defaultWeight: 40 },
  { key: 'battery', ratingKeys: ['batteryLife', 'chargeSpeed'], label: 'Battery', defaultWeight: 30 },
  { key: 'screen', ratingKey: 'screen', label: 'Screen', defaultWeight: 20, shrinkage: { alpha: 0.5, mean: 3 } },
  { key: 'build', ratingKey: 'build', label: 'Build', defaultWeight: 10 },
];
const model = createWeightModel({ dimensions: DIMENSIONS, storageSchemaVersion: 2 });
const { DEFAULT_WEIGHTS, arrayToWeights, weightsToArray, weightTotal, validPercentWeights, normalizePercentWeights, rebalanceWeights, migrateStoredWeights, persistableWeights, calculatePersonalisedScore, getMetricValue, rankItems } = model;
const values = (w) => DIMENSIONS.map((d) => w[d.key]);
const fullyRated = (value = 4) => Object.fromEntries(DIMENSIONS.flatMap((d) => ratingKeysOf(d).map((k) => [k, value])));

describe('createWeightModel refuses a configuration that cannot allocate 100', () => {
  it('needs dimensions', () => assert.throws(() => createWeightModel({}), /needs dimensions/));
  it('refuses defaults that do not total 100', () =>
    assert.throws(() => createWeightModel({ dimensions: [{ key: 'a', defaultWeight: 60 }, { key: 'b', defaultWeight: 60 }] }), /must total 100/));
});

describe('parseFiniteNumber', () => {
  it('passes a finite number through', () => assert.equal(parseFiniteNumber(42.5), 42.5));
  it('rejects a non-finite number', () => {
    assert.equal(parseFiniteNumber(NaN), null);
    assert.equal(parseFiniteNumber(Infinity), null);
  });
  it('strips currency and thousands separators from a string', () => assert.equal(parseFiniteNumber('€45,000'), 45000));
  it('rejects a type it cannot read', () => {
    for (const value of [null, undefined, {}, []]) assert.equal(parseFiniteNumber(value), null);
  });
  // KNOWN GAP, pinned deliberately rather than endorsed. Stripping every non-numeric character
  // leaves 'n/a' as the empty string, and `Number('')` is 0. No catalogue holds a string rating
  // today; if this is fixed to return null, update this test with the fix.
  it('currently reads an unreadable string as zero rather than as absent', () => assert.equal(parseFiniteNumber('n/a'), 0));
});

describe('dimensionRating', () => {
  const camera = DIMENSIONS[0];
  const battery = DIMENSIONS[1];
  it('returns nothing when the record carries no rating for the dimension', () => assert.equal(dimensionRating({}, camera), null));
  it('returns nothing for an empty score set', () => assert.equal(dimensionRating(undefined, camera), null));
  it('reads a single-key dimension straight off the record', () => assert.equal(dimensionRating({ camera: 3.5 }, camera), 3.5));
  it('averages the keys a multi-key dimension reads', () => assert.equal(dimensionRating({ batteryLife: 3, chargeSpeed: 5 }, battery), 4));
  // A dimension rated on only half its evidence is not rated. Averaging the half that is present
  // would publish a figure derived from one of its two measures without saying so.
  it('returns nothing when only part of a multi-key dimension is rated', () => assert.equal(dimensionRating({ batteryLife: 3 }, battery), null));
});

describe('effectiveRating shrinks a weakly evidenced dimension towards the mean', () => {
  it('leaves a firmly evidenced dimension untouched', () => assert.equal(effectiveRating(4.6, DIMENSIONS[0]), 4.6));
  it('pulls an extreme rating in on a weak dimension by its alpha', () => assert.equal(effectiveRating(5, DIMENSIONS[2]), 4));
  it('passes a missing rating straight through', () => assert.equal(effectiveRating(null, DIMENSIONS[2]), null));
});

describe('weight array helpers', () => {
  it('round-trips a weight set through the array form', () => assert.deepEqual(values(arrayToWeights(weightsToArray(DEFAULT_WEIGHTS))), values(DEFAULT_WEIGHTS)));
  it('fills a short array with zeros rather than undefined', () => assert.deepEqual(values(arrayToWeights([50])), [50, 0, 0, 0]));
  it('totals the default allocation to exactly 100', () => assert.equal(weightTotal(DEFAULT_WEIGHTS), 100));
  // A non-finite weight must not turn the running total into NaN, or every downstream validity
  // check silently returns false and the panel reports nothing allocated.
  it('skips a non-finite weight instead of poisoning the total', () => assert.equal(weightTotal({ ...DEFAULT_WEIGHTS, camera: NaN }), 60));
  it('totals an empty weight set to zero', () => assert.equal(weightTotal({}), 0));
});

describe('validPercentWeights', () => {
  it('accepts the defaults', () => assert.equal(validPercentWeights(DEFAULT_WEIGHTS), true));
  it('rejects a set that does not total 100', () => assert.equal(validPercentWeights({ ...DEFAULT_WEIGHTS, camera: 41 }), false));
  it('rejects a fractional weight', () => assert.equal(validPercentWeights({ ...DEFAULT_WEIGHTS, camera: 39.5, battery: 30.5 }), false));
  it('rejects a negative weight', () => assert.equal(validPercentWeights({ ...DEFAULT_WEIGHTS, camera: -10, battery: 80 }), false));
  it('rejects an empty set', () => assert.equal(validPercentWeights({}), false));
});

describe('normalizePercentWeights', () => {
  it('scales a set that does not total 100 back onto 100', () => assert.equal(weightTotal(normalizePercentWeights({ camera: 10, battery: 10, screen: 10, build: 10 })), 100));
  it('falls back to the defaults for an all-zero set', () => assert.deepEqual(values(normalizePercentWeights({ camera: 0, battery: 0, screen: 0, build: 0 })), values(DEFAULT_WEIGHTS)));
  it('falls back to the defaults for a set carrying a bad value', () => {
    for (const bad of [NaN, -5, 101]) assert.deepEqual(values(normalizePercentWeights({ ...DEFAULT_WEIGHTS, camera: bad })), values(DEFAULT_WEIGHTS));
  });
});

describe('rebalanceWeights keeps the allocation on 100', () => {
  it('holds the total at 100 when one slider moves', () => {
    const next = rebalanceWeights(DEFAULT_WEIGHTS, 'camera', 70);
    assert.equal(next.camera, 70);
    assert.equal(weightTotal(next), 100);
  });
  it('shares the remainder in proportion to the drag-start allocation', () => {
    // 30 left for battery:screen:build at 30:20:10, so 15:10:5.
    assert.deepEqual(values(rebalanceWeights(DEFAULT_WEIGHTS, 'camera', 70)), [70, 15, 10, 5]);
  });
  it('clamps a request above 100 and zeroes the rest', () => assert.deepEqual(values(rebalanceWeights(DEFAULT_WEIGHTS, 'camera', 150)), [100, 0, 0, 0]));
  it('clamps a negative request to zero', () => {
    const next = rebalanceWeights(DEFAULT_WEIGHTS, 'camera', -20);
    assert.equal(next.camera, 0);
    assert.equal(weightTotal(next), 100);
  });
  it('normalises instead of throwing when the key is not a dimension', () => assert.equal(weightTotal(rebalanceWeights(DEFAULT_WEIGHTS, 'not-a-dimension', 30)), 100));
  // Dragging a slider back down from 100 leaves every other weight at zero, so there is no
  // distribution left to share the remainder by. Falling back to the default shape is what stops
  // the other dimensions being stuck at zero for the rest of the session.
  it('rebuilds a distribution when every other weight is zero', () => {
    const next = rebalanceWeights({ camera: 100, battery: 0, screen: 0, build: 0 }, 'camera', 40);
    assert.deepEqual(values(next), [40, 30, 20, 10]);
  });
});

describe('largestRemainderRound', () => {
  it('rounds to the requested total without losing a point', () => assert.equal(largestRemainderRound([33.3, 33.3, 33.4], 100).reduce((a, b) => a + b, 0), 100));
  it('returns integers', () => assert.ok(largestRemainderRound([16.6, 16.6, 16.6, 16.6, 16.8, 16.8], 100).every(Number.isInteger)));
  it('gives the whole total to a single value', () => assert.deepEqual(largestRemainderRound([100], 100), [100]));
  it('returns nothing for nothing', () => assert.deepEqual(largestRemainderRound([], 100), []));
  // Ties on the remainder are broken by index, so the same input always rounds the same way and a
  // slider does not shuffle points between two dimensions on repeated drags.
  it('breaks a remainder tie by position, repeatably', () => {
    assert.deepEqual(largestRemainderRound([33.5, 33.5, 33], 100), [34, 33, 33]);
  });
  // The give-back direction. It previously only topped up: floors already above the total returned a
  // set summing above what was asked for, and nine sliders reached 112%.
  it('takes points back, never below zero, when the floors already exceed the total', () => {
    assert.deepEqual(largestRemainderRound([60, 60], 100), [50, 50]);
    assert.deepEqual(largestRemainderRound([1, 0], 0), [0, 0]);
  });
});

describe('calculatePersonalisedScore', () => {
  const scores = fullyRated(4);
  it('scores a fully rated item on the default allocation, out of 100', () => {
    // camera 40 x 4/5 + battery 30 x 4/5 + screen 20 x (3 + 0.5 x (4 - 3))/5 + build 10 x 4/5
    assert.equal(calculatePersonalisedScore(scores, DEFAULT_WEIGHTS), 32 + 24 + 14 + 8);
  });
  it('returns nothing for an item with no ratings at all', () => assert.equal(calculatePersonalisedScore({}, DEFAULT_WEIGHTS), null));
  // A dimension the visitor has given no weight to is not part of their question, so an item
  // missing a rating there must not be penalised for it.
  it('ignores a dimension the visitor weighted at zero', () => {
    const weights = { camera: 0, battery: 100, screen: 0, build: 0 };
    const withoutCamera = { ...scores };
    delete withoutCamera.camera;
    assert.equal(calculatePersonalisedScore(withoutCamera, weights), calculatePersonalisedScore(scores, weights));
  });
  // A dimension the visitor *is* asking about that the item has no rating for cannot be skipped:
  // that would score the item as if it had rated zero and rank it below items that were measured.
  it('publishes no score at all for an item unrated on a weighted dimension', () => {
    const withoutCamera = { ...scores };
    delete withoutCamera.camera;
    assert.equal(calculatePersonalisedScore(withoutCamera, DEFAULT_WEIGHTS), null);
  });
  it('normalises an invalid allocation instead of failing when asked to', () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args[0]);
    try {
      const score = calculatePersonalisedScore(scores, { camera: 5, battery: 5 }, DIMENSIONS, { productionFallback: true });
      assert.ok(Number.isFinite(score), `expected a score, got ${score}`);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /normalising safely/);
    } finally {
      console.warn = originalWarn;
    }
  });
  it('scores on the rating scale it was given', () => {
    const tenPoint = createWeightModel({ dimensions: DIMENSIONS, ratingScale: 10 });
    assert.equal(tenPoint.calculatePersonalisedScore({ ...fullyRated(8), screen: 3 }, { camera: 100, battery: 0, screen: 0, build: 0 }), 80);
    assert.equal(tenPoint.getMetricValue({ scores: fullyRated(8) }, 'camera', DEFAULT_WEIGHTS), 80);
  });
});

describe('getMetricValue', () => {
  const scores = fullyRated(4);
  it('returns the personalised score for the composite metric', () => assert.equal(getMetricValue({ scores }, 'personalisedScore', DEFAULT_WEIGHTS), calculatePersonalisedScore(scores, DEFAULT_WEIGHTS)));
  // A single-dimension axis is a rating out of five drawn on a 0-100 scale, unshrunk: it shows what
  // the sources published rather than what it may move.
  it('scales a single dimension onto the same 0-100 axis, without shrinkage', () => assert.equal(getMetricValue({ scores }, 'screen', DEFAULT_WEIGHTS), 80));
  it('returns nothing for a metric key that is not a dimension', () => assert.equal(getMetricValue({ scores }, 'not-a-metric', DEFAULT_WEIGHTS), null));
  it('returns nothing when the item has no rating on that dimension', () => assert.equal(getMetricValue({ scores: {} }, 'camera', DEFAULT_WEIGHTS), null));
});

describe('migrateStoredWeights rejects what it cannot identify', () => {
  const defaults = values(DEFAULT_WEIGHTS);
  it('discards an allocation whose scale the payload does not state', () => {
    const result = migrateStoredWeights({ weights: { camera: 40, battery: 30, screen: 20, build: 10 } });
    assert.deepEqual(values(result.weights), defaults);
    assert.equal(result.valid, false);
    assert.equal(result.migrated, false);
  });
  it('discards a current-schema payload carrying a weight outside the scale', () => {
    const result = migrateStoredWeights({ weightSchemaVersion: 2, weightUnit: 'percent', weights: { camera: 150, battery: 30, screen: 20, build: 10 } });
    assert.deepEqual(values(result.weights), defaults);
    assert.equal(result.valid, false);
  });
  it('discards a payload that is not JSON, is empty, or allocates nothing', () => {
    for (const payload of ['{not json', '', null, undefined, { weights: {} }]) {
      const result = migrateStoredWeights(payload);
      assert.deepEqual(values(result.weights), defaults, JSON.stringify(payload));
      assert.equal(result.valid, false);
    }
  });
  it('accepts a stored allocation handed over as the JSON string it was saved as', () => {
    const result = migrateStoredWeights(JSON.stringify(persistableWeights({ camera: 25, battery: 25, screen: 25, build: 25 })));
    assert.deepEqual(values(result.weights), [25, 25, 25, 25]);
    assert.equal(result.valid, true);
    assert.equal(result.migrated, false);
  });
  it('migrates an allocation on the rating scale itself to percentages', () => {
    const result = migrateStoredWeights({ weights: { camera: 5, battery: 5, screen: 0, build: 0 } });
    assert.deepEqual(values(result.weights), [50, 50, 0, 0]);
    assert.equal(result.migrated, true);
  });
  // The hook an instance uses when its dimensions change: a saved allocation from before the split
  // is brought up to date rather than discarded, which would silently reset a returning visitor.
  it('runs the instance migration on an out-of-date schema and not on the current one', () => {
    const split = createWeightModel({
      dimensions: DIMENSIONS,
      storageSchemaVersion: 2,
      migrate: (candidate) => {
        if (!candidate || Number.isFinite(Number(candidate.build))) return candidate;
        const { screenBuild = 0, ...rest } = candidate;
        return { ...rest, screen: Math.ceil(screenBuild / 2), build: Math.floor(screenBuild / 2) };
      },
    });
    const migrated = split.migrateStoredWeights({ weightSchemaVersion: 1, weightUnit: 'percent', weights: { camera: 40, battery: 30, screenBuild: 30 } });
    assert.deepEqual(values(migrated.weights), [40, 30, 15, 15]);
    assert.equal(migrated.migrated, true);
    const current = split.migrateStoredWeights({ weightSchemaVersion: 2, weightUnit: 'percent', weights: { camera: 40, battery: 30, screen: 30, build: 0 } });
    assert.deepEqual(values(current.weights), [40, 30, 30, 0]);
    assert.equal(current.migrated, false);
  });
});

describe('competition ranking', () => {
  const item = (id, score, price) => ({ id, name: id, personalisedScore: score, purchasePrice: price });
  it('shares a rank across a tie and skips the ranks it shares', () => {
    const ranked = rankItems([item('a', 80, 1), item('b', 79, 2), item('c', 79, 3), item('d', 70, 4)]);
    assert.deepEqual(ranked.map((entry) => [entry.id, entry.rank, entry.tiedRank]), [['a', 1, false], ['b', 2, true], ['c', 2, true], ['d', 4, false]]);
  });
  it('orders a shared rank cheapest first', () => {
    const ranked = rankItems([item('dear', 80, 30), item('cheap', 80, 10)]);
    assert.deepEqual(ranked.map((entry) => entry.id), ['cheap', 'dear']);
  });
  // Each item is compared with its group's leader, never with the row above it, or a group chains
  // without limit: 80, 79, 78 at a tolerance of 1.5 would tie all three.
  it('anchors a tolerance on the group leader rather than chaining', () => {
    const ranked = rankTiedScores([item('a', 80), item('b', 79), item('c', 78)], (entry) => entry.personalisedScore, 1.5);
    assert.deepEqual(ranked.map((entry) => entry.rank), [1, 1, 3]);
  });
  it('lets the tolerance follow each pair', () => {
    const ranked = rankTiedScores([item('a', 80), item('b', 78)], (entry) => entry.personalisedScore, (leader, entry) => (entry.id === 'b' ? 3 : 0));
    assert.deepEqual(ranked.map((entry) => entry.rank), [1, 1]);
  });
  it('puts an unscored item last', () => {
    assert.deepEqual(rankItems([item('none', null, 1), item('some', 50, 2)]).map((entry) => entry.id), ['some', 'none']);
  });
});

describe('exceedsBand', () => {
  // 1.1 - 0.8 is 0.30000000000000004 and 0.7 - 0.4 is 0.29999999999999993: at a band of 0.3 a strict
  // comparison separated one pair and tied the other.
  it('does not let the last bit of a float decide a pair whose gap is the band', () => {
    assert.equal(exceedsBand(1.1 - 0.8, 0.3), false);
    assert.equal(exceedsBand(0.7 - 0.4, 0.3), false);
    assert.equal(exceedsBand(0.31, 0.3), true);
  });
  it('treats a zero band as equality to within the same floor', () => {
    assert.equal(exceedsBand(0.1 + 0.2 - 0.3, 0), false);
    assert.equal(exceedsBand(0.001, 0), true);
  });
});
