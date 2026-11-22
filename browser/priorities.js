// Priorities a visitor states without typing a percentage: an order of importance, or a level for
// each dimension. Ported from Whichcar's scoring module (22 November 2026), where each rule below was
// set and measured; nothing here names a dimension. An instance binds its dimensions once:
//
//   const priorities = createPriorityModel({ dimensions: DIMENSIONS });
//   export const levelWeights = priorities.levelWeights;
//
// Every function returns whole percentages summing to exactly 100, so its output is a valid weight
// set for `createWeightModel` and survives storage, links and `migrateStoredWeights` unchanged.

// Ten sliders that must total 100% ask a visitor for a number nobody holds -- what is 16% of
// Reliability? What a visitor can say is the order. An order becomes percentages by rank-order
// centroid weighting (Barron & Barrett, 1996, "Decision quality using ranked attribute weights"):
// with k priorities ranked, place i gets (1/k) * sum over j = i..k of 1/j. It is the centre of every
// set of weights consistent with the order: a stated rule rather than a number chosen for the visitor.
// The shares of k ranked places, largest first, summing to 1.
export function rankOrderCentroid(k) {
  if (!Number.isInteger(k) || k < 1) return [];
  return Array.from({ length: k }, (_, i) => {
    let sum = 0;
    for (let j = i + 1; j <= k; j += 1) sum += 1 / j;
    return sum / k;
  });
}

// Four levels -- Not counted, Matters a little, Matters, Matters most -- as fixed multiples, 9 : 2 : 1.
// In Whichcar a level was first a place in a ranking, and with ten priorities counted that gave
// "Matters most" 24%: the owner reported that a tap barely moved the chart, and measured on the
// default view the best match changed on 4 of 9 taps. At 9 : 2 : 1 one priority at Matters most
// carries 38-39% beside defaults, and the best match changed on 8 of 10 taps.
export const IMPORTANCE_LEVEL_WEIGHTS = Object.freeze([0, 1, 2, 9]);

export function createPriorityModel({ dimensions = [] } = {}) {
  const sameWeightSet = (a, b, dims) => dims.every((d) => a?.[d.key] === b?.[d.key]);
  const wholePercentages = (weights, dims) => {
    const values = dims.map((d) => weights?.[d.key]);
    return (
      values.length > 0 &&
      values.every((value) => Number.isInteger(value) && value >= 0 && value <= 100) &&
      values.reduce((sum, value) => sum + value, 0) === 100
    );
  };

  // Whole percentages for groups of equals: the leftover points go to whole groups before single
  // members, so a group of equals stays equal wherever the total allows (three equal priorities are
  // 33.3% each, and only then does one take the extra point). `groups` carry `place`, `members`, and
  // the `floor` and `remainder` of each member's share.
  function roundGroups(groups, dims) {
    const weights = Object.fromEntries(dims.map((d) => [d.key, 0]));
    for (const group of groups) for (const member of group.members) weights[member.key] = group.floor;
    let leftover = 100 - Object.values(weights).reduce((sum, value) => sum + value, 0);
    const byRemainder = [...groups].sort((a, b) => b.remainder - a.remainder || a.place - b.place);
    const raised = new Set();
    for (const group of byRemainder) {
      if (group.members.length > leftover) continue;
      for (const member of group.members) {
        weights[member.key] += 1;
        raised.add(member.key);
      }
      leftover -= group.members.length;
    }
    // What no whole group could take, single priorities take -- largest remainder first, then the
    // order the dimensions are declared in -- never one that has already been raised.
    for (const group of byRemainder)
      for (const member of group.members) {
        if (leftover <= 0) break;
        if (raised.has(member.key)) continue;
        weights[member.key] += 1;
        raised.add(member.key);
        leftover -= 1;
      }
    return weights;
  }

  // A ranking is `{ [dimensionKey]: place }`, place a whole number from 1; a priority that is absent
  // is unranked and counts 0%. Two priorities given the same place share the mean of the positions
  // they occupy. Places are relative, so a gap ("1st" and "3rd", nothing second) closes up. Null for
  // an empty ranking, which is not a set of weights at all.
  function rankingWeights(ranking = {}, dims = dimensions) {
    const ranked = dims.filter((d) => Number.isInteger(ranking?.[d.key]) && ranking[d.key] >= 1);
    if (!ranked.length) return null;
    const shares = rankOrderCentroid(ranked.length);
    const places = [...new Set(ranked.map((d) => ranking[d.key]))].sort((a, b) => a - b);
    const groups = [];
    let position = 0;
    for (const place of places) {
      const members = ranked.filter((d) => ranking[d.key] === place);
      const each = (members.reduce((sum, _, i) => sum + shares[position + i], 0) / members.length) * 100;
      const floor = Math.floor(each);
      groups.push({ place, members, floor, remainder: each - floor });
      position += members.length;
    }
    return roundGroups(groups, dims);
  }

  // The ranking a set of weights came from, or null if no ranking produces exactly these weights. A
  // page that stores weights and nothing else gets its ranking back this way after a reload or
  // through a shared link, and stops claiming one the moment a slider moves. The nonzero weights are
  // taken largest first and every way of grouping neighbours into equal places is tried, fewest ties
  // first, so a strict order is preferred where both would fit.
  function rankingFromWeights(weights = {}, dims = dimensions) {
    if (!wholePercentages(weights, dims)) return null;
    const order = dims
      .map((d, index) => ({ key: d.key, weight: weights[d.key], index }))
      .filter((entry) => entry.weight > 0)
      .sort((a, b) => b.weight - a.weight || a.index - b.index);
    const joins = order.length - 1;
    const masks = Array.from({ length: 2 ** joins }, (_, mask) => mask);
    const ties = (mask) => mask.toString(2).replace(/0/g, '').length;
    for (const mask of masks.sort((a, b) => ties(a) - ties(b) || a - b)) {
      const ranking = {};
      let place = 1;
      order.forEach((entry, i) => {
        if (i > 0 && !(mask & (1 << (i - 1)))) place += 1;
        ranking[entry.key] = place;
      });
      if (sameWeightSet(rankingWeights(ranking, dims), weights, dims)) return ranking;
    }
    return null;
  }

  // Levels to weights: equal levels share equal percentages, rounded the way `rankingWeights` rounds
  // groups, and gaps between levels are kept -- one priority at Matters most and one at Matters a
  // little are not read as first and second. Null when nothing is counted.
  function levelWeights(levels = {}, dims = dimensions) {
    const levelOf = (d) => {
      const level = levels?.[d.key];
      return Number.isInteger(level) && level >= 0 && level < IMPORTANCE_LEVEL_WEIGHTS.length ? level : 0;
    };
    const total = dims.reduce((sum, d) => sum + IMPORTANCE_LEVEL_WEIGHTS[levelOf(d)], 0);
    if (!total) return null;
    const groups = [3, 2, 1]
      .map((level) => ({ place: 4 - level, members: dims.filter((d) => levelOf(d) === level) }))
      .filter((group) => group.members.length)
      .map((group) => {
        const each = (100 * IMPORTANCE_LEVEL_WEIGHTS[4 - group.place]) / total;
        return { ...group, floor: Math.floor(each), remainder: each - Math.floor(each) };
      });
    return roundGroups(groups, dims);
  }

  // The levels a set of weights came from, or null if no set of levels produces exactly these
  // weights: how level chips survive a reload. Levels never rise down the weights, so the counted
  // priorities, largest first, are cut into at most three runs, one per level used.
  function levelsFromWeights(weights = {}, dims = dimensions) {
    if (!wholePercentages(weights, dims)) return null;
    const order = dims
      .map((d, index) => ({ key: d.key, weight: weights[d.key], index }))
      .filter((entry) => entry.weight > 0)
      .sort((a, b) => b.weight - a.weight || a.index - b.index);
    const n = order.length;
    const zero = Object.fromEntries(dims.map((d) => [d.key, 0]));
    const cutsFor = (runs) => {
      if (runs === 1) return [[n]];
      if (runs === 2) return Array.from({ length: n - 1 }, (_, a) => [a + 1, n]);
      const cuts = [];
      for (let a = 1; a < n - 1; a += 1) for (let b = a + 1; b < n; b += 1) cuts.push([a, b, n]);
      return cuts;
    };
    const levelSets = [[3], [2], [1], [3, 2], [3, 1], [2, 1], [3, 2, 1]];
    for (const used of levelSets)
      for (const cuts of cutsFor(used.length)) {
        const levels = { ...zero };
        let start = 0;
        cuts.forEach((cut, i) => {
          for (const entry of order.slice(start, cut)) levels[entry.key] = used[i];
          start = cut;
        });
        if (sameWeightSet(levelWeights(levels, dims), weights, dims)) return levels;
      }
    return null;
  }

  return { rankingWeights, rankingFromWeights, levelWeights, levelsFromWeights };
}
