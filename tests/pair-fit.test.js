// "Help me choose" (browser/pair-fit.js), ported from Whichcar's tests with phones in place of cars.
// Each test names the wrong thing the cards would do without it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPairFit, pairKey, PAIR_POOL, PAIR_PRICE_RATIO, DRAW_MARGIN, PICK_MARGIN } from '../browser/pair-fit.js';
import { createPriorityModel } from '../browser/priorities.js';
import { createWeightModel } from '../browser/weights.js';

const KEYS = ['camera', 'battery', 'screen', 'build', 'speed', 'storage'];
const DIMENSIONS = KEYS.map((key, i) => ({ key, ratingKey: key, label: key[0].toUpperCase() + key.slice(1), defaultWeight: [30, 20, 20, 10, 10, 10][i] }));
const { calculatePersonalisedScore } = createWeightModel({ dimensions: DIMENSIONS });
const { levelWeights } = createPriorityModel({ dimensions: DIMENSIONS });
const scoreOf = (item, weights) => calculatePersonalisedScore(item?.scores ?? {}, weights);
const fit = createPairFit({ dimensions: DIMENSIONS, levelWeights, scoreOf });
const { dimensionVector, scoreGap, nextPair, fitLevels, levelChanges, changesText } = fit;

const levels = (overrides = {}) => Object.fromEntries(KEYS.map((k) => [k, overrides[k] ?? 1]));
// A seeded catalogue of phones rated 1 to 5 on every dimension.
let seed = 11;
const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
const phones = Array.from({ length: 30 }, (_, i) => ({
  id: `p${i}`,
  name: `Phone ${i}`,
  purchasePrice: 400 + Math.round(next() * 800),
  scores: Object.fromEntries(KEYS.map((k) => [k, 1 + Math.round(next() * 40) / 10])),
}));
// Items carrying their vector directly, so a fit test states exactly what each is better at.
const vec = (spec) => KEYS.map((k) => spec[k] ?? 50);
const fake = (id, price, spec) => ({ id, name: id, purchasePrice: price, x: vec(spec) });
const vectorOf = (item) => item.x ?? null;

describe('createPairFit', () => {
  it('refuses a configuration it cannot fit with', () => {
    assert.throws(() => createPairFit({ levelWeights, scoreOf }), /needs dimensions/);
    assert.throws(() => createPairFit({ dimensions: DIMENSIONS, scoreOf }), /needs levelWeights and scoreOf/);
  });
});

describe('an item as one score per dimension', () => {
  // The fit predicts the page's ordering from these vectors. If a weighted average of them were not
  // the page's own match score, a fit that "agreed" with a pick could still rank the two the other way.
  it('reproduces the match score under any levels, on the page’s whole-percent weights', () => {
    const set = levels({ camera: 3, battery: 2, build: 0 });
    const weights = levelWeights(set);
    for (const [a, b] of [[phones[0], phones[1]], [phones[2], phones[3]], [phones[4], phones[5]]]) {
      const direct = scoreOf(a, weights) - scoreOf(b, weights);
      assert.ok(Math.abs(scoreGap(set, dimensionVector(a), dimensionVector(b)) - direct) < 1e-9);
    }
  });
  // An item the page cannot score on every dimension would be fitted against a hole read as zero.
  it('is null when any dimension cannot be scored, never a zero', () =>
    assert.equal(dimensionVector({ scores: { camera: 4 } }), null));
});

describe('the next pair', () => {
  const ranked = [...phones].sort((a, b) => scoreOf(b, levelWeights(levels())) - scoreOf(a, levelWeights(levels())));
  // Two items far apart in price turn a pick into a question about money, which a budget already asks.
  it('is two of the closest matches within a quarter of each other on price', () => {
    const pair = nextPair(ranked, levels());
    assert.ok(pair, 'the catalogue offers a pair');
    const pool = ranked.slice(0, PAIR_POOL).map((p) => p.id);
    assert.ok(pool.includes(pair.a.id) && pool.includes(pair.b.id));
    const ratio = pair.a.purchasePrice / pair.b.purchasePrice;
    assert.ok(ratio <= PAIR_PRICE_RATIO && ratio >= 1 / PAIR_PRICE_RATIO);
  });
  // A pair where one item is ahead on everything has an answer already: picking it teaches nothing.
  it('is never a pair where one item is ahead on every difference', () => {
    const a = fake('a', 500, { camera: 90, battery: 90 });
    const b = fake('b', 500, { camera: 50, battery: 50 });
    assert.equal(nextPair([a, b], levels(), new Set(), vectorOf), null);
  });
  // Showing the same two again asks a question the visitor has answered; an unpriced item has no price
  // to be "about the same" as.
  it('never repeats a pair, and skips an item without a price', () => {
    const a = fake('a', 500, { camera: 90, battery: 30 });
    const b = fake('b', 510, { camera: 30, battery: 90 });
    const c = { ...fake('c', null, { camera: 30, battery: 90 }), purchasePrice: null };
    assert.deepEqual(nextPair([a, b, c], levels(), new Set(), vectorOf), { a, b });
    assert.equal(nextPair([a, b, c], levels(), new Set([pairKey(b, a)]), vectorOf), null);
  });
  // An instance may hold items with a price that is not one to compare (Whichcar's price-pending cars).
  it('takes the instance’s own test of a usable price', () => {
    const strict = createPairFit({ dimensions: DIMENSIONS, levelWeights, scoreOf, priced: (item) => !item.pending });
    const a = fake('a', 500, { camera: 90, battery: 30 });
    const b = { ...fake('b', 510, { camera: 30, battery: 90 }), pending: true };
    assert.equal(strict.nextPair([a, b], levels(), new Set(), vectorOf), null);
  });
});

describe('fitting the levels to the picks', () => {
  const a = fake('a', 500, { camera: 90, battery: 30 });
  const b = fake('b', 500, { camera: 30, battery: 90 });
  it('leaves the stated levels alone until a pick disagrees with them', () => {
    const prior = levels({ camera: 3 });
    assert.deepEqual(fitLevels([], prior, vectorOf).levels, prior);
    assert.deepEqual(fitLevels([{ a, b, choice: 'a' }], prior, vectorOf).levels, prior);
  });
  it('raises what the chosen item is better at when the stated levels disagree with the pick', () => {
    const result = fitLevels([{ a, b, choice: 'b' }], levels({ camera: 3 }), vectorOf);
    assert.equal(result.agreed, 1);
    assert.ok(scoreGap(result.levels, b.x, a.x) >= PICK_MARGIN);
  });
  // "Not counted" is the visitor's own statement; a pick is not a reason to count it after all.
  it('never counts a priority the visitor set to Not counted', () =>
    assert.equal(fitLevels([{ a, b, choice: 'b' }], levels({ camera: 3, battery: 0 }), vectorOf).levels.battery, 0));
  it('reads a draw as the two scoring close together', () => {
    const result = fitLevels([{ a, b, choice: 'draw' }], levels({ camera: 3 }), vectorOf);
    assert.equal(result.agreed, 1);
    assert.ok(Math.abs(scoreGap(result.levels, a.x, b.x)) < DRAW_MARGIN);
  });
  // The fit judges picks on unrounded shares first and rounds only where that could change the answer.
  // A bound that was too tight would return levels the full rounded search does not.
  it('returns what rounding every combination returns', () => {
    const reference = (picks, prior) => {
      const start = KEYS.map((k) => prior[k]);
      const free = start.map((l, i) => (l ? i : null)).filter((i) => i !== null);
      let best = null;
      for (let n = 0; n < 3 ** free.length; n += 1) {
        const current = start.slice();
        let x = n;
        for (const i of free) {
          current[i] = 1 + (x % 3);
          x = Math.floor(x / 3);
        }
        const set = Object.fromEntries(KEYS.map((k, i) => [k, current[i]]));
        let agreed = 0;
        for (const pick of picks) {
          const gap = scoreGap(set, dimensionVector(pick.a), dimensionVector(pick.b));
          if (pick.choice === 'draw' ? Math.abs(gap) < DRAW_MARGIN : (pick.choice === 'a' ? gap : -gap) >= PICK_MARGIN) agreed += 1;
        }
        const distance = current.reduce((sum, l, i) => sum + Math.abs(l - start[i]), 0);
        if (!best || agreed > best.agreed || (agreed === best.agreed && distance < best.distance)) best = { agreed, distance };
      }
      return best;
    };
    for (let trial = 0; trial < 12; trial += 1) {
      const prior = levels({ [KEYS[trial % 6]]: 3, [KEYS[(trial + 3) % 6]]: trial % 4 ? 2 : 0 });
      const picks = Array.from({ length: 4 }, (_, i) => ({
        a: phones[Math.floor(next() * phones.length)],
        b: phones[Math.floor(next() * phones.length)],
        choice: ['a', 'b', 'draw'][(i + trial) % 3],
      }));
      const result = fitLevels(picks, prior);
      const want = reference(picks, prior);
      assert.equal(result.agreed, want.agreed, `trial ${trial}`);
      assert.equal(KEYS.reduce((sum, k) => sum + Math.abs(result.levels[k] - prior[k]), 0), want.distance, `trial ${trial}`);
    }
  });
});

describe('what the picks moved', () => {
  it('is said in the level chips’ own words, and says so when nothing moved', () => {
    assert.equal(changesText([]), 'Your picks agree with what you told us, so nothing has moved.');
    const text = changesText(levelChanges(levels({ camera: 3 }), levels({ camera: 2, storage: 3 })));
    assert.equal(text, 'Your picks moved Storage up to Matters most, and Camera down to Matters.');
    assert.equal(changesText(levelChanges(levels({ camera: 3 }), levels({ camera: 2 }))), 'Your picks moved Camera down to Matters.');
  });
});
