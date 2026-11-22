// "Help me choose": two of the visitor's closest matches side by side, and which they would rather
// live with. Ported from Whichcar (22 November 2026), where it follows the questions on the results
// page.
//
// Three stated priorities say what matters most and nothing about the rest, and a visitor rarely
// knows they care about something until two items of one price differ on it. Each pick is a
// statement about two real items, and the importance levels are fitted to agree with as many of those
// statements as they can while moving as little as possible from what the visitor said. Simulated on
// Whichcar's catalogue (21 November 2026, five customers, twenty runs each): one stated priority alone
// found the customer's own best car for two of the five; six questions and then six picks found it in
// 89% of runs. The cards complement the questions and never replace them.
//
// Nothing here scores. The fit only chooses importance levels (browser/priorities.js), and the page
// scores with them as it scores anything else. An instance binds its dimensions, its level weights and
// its score once:
//
//   const pairFit = createPairFit({ dimensions, levelWeights, scoreOf: (item, w) => score(item.scores, w) });
//
// What a pair card shows about the two items is the instance's.
import { IMPORTANCE_LEVEL_WEIGHTS } from './priorities.js';

// The pair is drawn from the visitor's closest matches, so a pick is between items they might buy.
export const PAIR_POOL = 8;
// Two items of about one price, so a pick is about the items and not about the money.
export const PAIR_PRICE_RATIO = 1.25;
// A dimension counts as a difference between the two only beyond this many points out of 100: about
// the band one rating carries, so the pair is not chosen for a gap the evidence cannot see.
export const PAIR_GAP = 8;
// A pick for one item agrees with priorities that put it ahead by at least this much; a draw agrees
// with priorities that keep the two within the wider margin.
export const PICK_MARGIN = 0.2;
export const DRAW_MARGIN = 1.5;
export const PICK_CHOICES = Object.freeze(['a', 'b', 'draw']);
export const LEVEL_NAMES = Object.freeze(['Not counted', 'Matters a little', 'Matters', 'Matters most']);
const PAIR_LEVELS = [1, 2, 3];

// The same two items in either order are one pair.
export function pairKey(a, b) {
  return [a.id, b.id].sort().join('|');
}
// Whether weights agree with a pick, given the gap they put between its two items.
function pickAgrees(choice, gap) {
  return choice === 'draw' ? Math.abs(gap) < DRAW_MARGIN : (choice === 'a' ? gap : -gap) >= PICK_MARGIN;
}

export function createPairFit({
  dimensions = [],
  levelWeights,
  scoreOf,
  priced = (item) => Number.isFinite(item?.purchasePrice) && item.purchasePrice > 0,
} = {}) {
  if (!dimensions.length) throw new Error('createPairFit needs dimensions');
  if (typeof levelWeights !== 'function' || typeof scoreOf !== 'function')
    throw new Error('createPairFit needs levelWeights and scoreOf');
  // An item's score on each dimension alone, out of 100, in dimensions order: the terms a match score is a
  // weighted average of, so a score under any levels is a weighted average of these. Null when the item
  // lacks one, since an item the page cannot score under every level cannot be fitted against.
  function dimensionVector(item) {
    const out = [];
    for (const dimension of dimensions) {
      const one = Object.fromEntries(dimensions.map((d) => [d.key, d.key === dimension.key ? 100 : 0]));
      const value = scoreOf(item, one);
      if (!Number.isFinite(value)) return null;
      out.push(value);
    }
    return out;
  }
  const levelArray = (levels) =>
    dimensions.map((d) => (Number.isInteger(levels?.[d.key]) ? levels[d.key] : 0));
  const levelObject = (array) => Object.fromEntries(dimensions.map((d, i) => [d.key, array[i]]));
  // How far ahead item A is of item B under these levels, in match-score points. Read through the
  // whole-percent weights the page itself scores with (`levelWeights`), not the raw 9 : 2 : 1 shares:
  // on Whichcar's catalogue the rounding moved a gap by up to 1.1 points, more than the margin a pick
  // is judged by, so a fit on the raw shares could "agree" with a pick the page then ranks the other way.
  function weightList(levelList) {
    const weights = levelWeights(levelObject(levelList));
    return weights ? dimensions.map((d) => weights[d.key]) : null;
  }
  function gapUnder(weights, a, b) {
    if (!weights) return 0;
    let sum = 0;
    let total = 0;
    for (let i = 0; i < weights.length; i += 1) {
      sum += weights[i] * (a[i] - b[i]);
      total += weights[i];
    }
    return total ? sum / total : 0;
  }
  function scoreGap(levels, a, b) {
    return gapUnder(weightList(levelArray(levels)), a, b);
  }

  // The next pair: of the visitor's closest matches, two of about one price that differ most in both
  // directions -- each ahead on something -- and are closest on the visitor's current score, so the
  // pick says something the score has not already decided. Null when no such pair is left.
  function nextPair(ranked = [], levels = {}, used = new Set(), vectorOf = dimensionVector) {
    const pool = ranked
      .filter(priced)
      .map((item) => ({ item, x: vectorOf(item) }))
      .filter((entry) => entry.x)
      .slice(0, PAIR_POOL);
    let best = null;
    let bestValue = 0;
    for (let i = 0; i < pool.length; i += 1)
      for (let j = i + 1; j < pool.length; j += 1) {
        const a = pool[i];
        const b = pool[j];
        if (used.has(pairKey(a.item, b.item))) continue;
        const ratio = a.item.purchasePrice / b.item.purchasePrice;
        if (ratio > PAIR_PRICE_RATIO || ratio < 1 / PAIR_PRICE_RATIO) continue;
        let up = 0;
        let down = 0;
        for (let k = 0; k < a.x.length; k += 1) {
          const d = a.x[k] - b.x[k];
          if (d > PAIR_GAP) up += d;
          if (d < -PAIR_GAP) down -= d;
        }
        const value = Math.min(up, down) - Math.abs(scoreGap(levels, a.x, b.x));
        if (value > bestValue) {
          bestValue = value;
          best = { a: a.item, b: b.item };
        }
      }
    return best;
  }

  // The levels that agree with the most picks, and among those the nearest to where the visitor
  // started. Every combination of the three counted levels is tried, 3^10 = 59,049 of them, so the
  // answer is the best one rather than a local guess. A priority the visitor set to "Not counted" stays
  // there: a pick between two items is not a reason to count something they said not to.
  //
  // Agreement is judged on the page's own whole-percent weights, and rounding all 59,049 took 450 ms a
  // pick in Node, too slow for a press on a phone. So each combination is first judged on its unrounded
  // shares, which no rounded weight is a whole point away from: a pick whose unrounded gap clears its
  // threshold by more than the sum of its items' per-dimension differences over 100 is decided either way,
  // and the rounding is done only for a combination whose undecided picks could still make it the best.
  // The answer is the one the full rounded search gives; tests/pair-fit.test.js compares the two.
  function fitLevels(picks = [], prior = {}, vectorOf = dimensionVector) {
    const start = levelArray(prior);
    const stated = picks
      .filter((pick) => PICK_CHOICES.includes(pick.choice))
      .map((pick) => ({ choice: pick.choice, a: vectorOf(pick.a), b: vectorOf(pick.b) }))
      .filter((pick) => pick.a && pick.b)
      .map((pick) => ({
        ...pick,
        slack: pick.a.reduce((sum, value, i) => sum + Math.abs(value - pick.b[i]), 0) / 100 + 1e-9,
      }));
    if (!stated.length) return { levels: levelObject(start), agreed: 0, total: 0 };
    const free = start.map((level, i) => (level === 0 ? null : i)).filter((i) => i !== null);
    const current = start.slice();
    const shares = new Array(start.length).fill(0);
    let best = start.slice();
    let bestAgreed = -1;
    let bestDistance = Infinity;
    const visit = (index) => {
      if (index === free.length) {
        let distance = 0;
        let total = 0;
        for (let i = 0; i < current.length; i += 1) {
          distance += Math.abs(current[i] - start[i]);
          total += IMPORTANCE_LEVEL_WEIGHTS[current[i]] ?? 0;
        }
        for (let i = 0; i < current.length; i += 1)
          shares[i] = total ? (100 * (IMPORTANCE_LEVEL_WEIGHTS[current[i]] ?? 0)) / total : 0;
        let sure = 0;
        const open = [];
        for (const pick of stated) {
          const gap = gapUnder(shares, pick.a, pick.b);
          // Decided when every gap within the slack falls on one side: a pick for one item agrees above a
          // threshold, so its band's two ends say it; a draw agrees inside a window, so its band has to sit
          // wholly inside or wholly beyond one edge.
          const verdict =
            pick.choice === 'draw'
              ? Math.abs(gap) + pick.slack < DRAW_MARGIN
                ? true
                : Math.abs(gap) - pick.slack >= DRAW_MARGIN
                  ? false
                  : null
              : pickAgrees(pick.choice, gap - pick.slack) === pickAgrees(pick.choice, gap + pick.slack)
                ? pickAgrees(pick.choice, gap)
                : null;
          if (verdict !== null) sure += verdict ? 1 : 0;
          else open.push(pick);
        }
        const most = sure + open.length;
        if (most < bestAgreed || (most === bestAgreed && distance >= bestDistance)) return;
        let agreed = sure;
        if (open.length) {
          const weights = weightList(current);
          for (const pick of open)
            if (pickAgrees(pick.choice, gapUnder(weights, pick.a, pick.b))) agreed += 1;
        }
        if (agreed > bestAgreed || (agreed === bestAgreed && distance < bestDistance)) {
          bestAgreed = agreed;
          bestDistance = distance;
          best = current.slice();
        }
        return;
      }
      for (const level of PAIR_LEVELS) {
        current[free[index]] = level;
        visit(index + 1);
      }
      current[free[index]] = start[free[index]];
    };
    visit(0);
    return { levels: levelObject(best), agreed: bestAgreed, total: stated.length };
  }

  // What moved, said in the level chips' own words.
  function levelChanges(before = {}, after = {}) {
    return dimensions
      .map((d) => ({
        key: d.key,
        label: d.label,
        from: before[d.key] ?? 0,
        to: after[d.key] ?? 0,
      }))
      .filter((change) => change.from !== change.to);
  }
  function changesText(changes = []) {
    if (!changes.length) return 'Your picks agree with what you told us, so nothing has moved.';
    const say = (list) => (list.length < 2 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);
    const up = changes.filter((c) => c.to > c.from).map((c) => `${c.label} up to ${LEVEL_NAMES[c.to]}`);
    const down = changes.filter((c) => c.to < c.from).map((c) => `${c.label} down to ${LEVEL_NAMES[c.to]}`);
    const parts = [];
    if (up.length) parts.push(`moved ${say(up)}`);
    if (down.length) parts.push(`${up.length ? '' : 'moved '}${say(down)}`);
    return `Your picks ${parts.join(', and ')}.`;
  }

  return { dimensionVector, scoreGap, nextPair, fitLevels, levelChanges, changesText };
}
