import assert from 'node:assert/strict';
import { describe,it } from 'node:test';
import { PRICE_FIELDS, configurePareto, dominates, findDominatingItem, getParetoFrontier, isComparable, markPareto, priceBounds } from '../browser/pareto.js';
const p=(id,price,score)=>({id,name:id,purchasePrice:price,score,personalisedScore:score});
describe('price-score Pareto frontier',()=>{
 it('detects dominance with lower price and higher score',()=>assert.equal(dominates(p('a',10,90),p('b',11,80)),true));
 it('handles equal prices by keeping only highest score on frontier',()=>assert.deepEqual(getParetoFrontier([p('low',10,80),p('high',10,90)]).map(x=>x.id),['high']));
 it('handles equal scores by keeping cheaper point',()=>assert.deepEqual(getParetoFrontier([p('cheap',10,90),p('exp',20,90)]).map(x=>x.id),['cheap']));
 it('keeps identical coordinates efficient by dominance definition',()=>assert.deepEqual(markPareto([p('a',10,90),p('b',10,90)]).map(x=>x.pareto),[true,true]));
 it('returns single-point frontier',()=>assert.deepEqual(getParetoFrontier([p('only',10,50)]).map(x=>x.id),['only']));
 it('updates membership as scores change',()=>{assert.deepEqual(getParetoFrontier([p('cheap',10,70),p('mid',20,80)]).map(x=>x.id),['cheap','mid']); assert.deepEqual(getParetoFrontier([p('cheap',10,90),p('mid',20,80)]).map(x=>x.id),['cheap']);});
});


describe('pareto comparability guards', () => {
  it('refuses to compare an item with no price', () => {
    assert.equal(isComparable(p('a', null, 90)), false);
    assert.equal(dominates(p('a', null, 90), p('b', 20000, 80)), false);
    assert.equal(dominates(p('a', 10000, 90), p('b', null, 80)), false);
  });
  it('refuses to compare an item with no score', () => {
    assert.equal(isComparable(p('a', 20000, null)), false);
    assert.equal(dominates(p('a', 20000, null), p('b', 30000, 80)), false);
  });
  it('refuses to compare a missing record', () => {
    assert.equal(isComparable(null), false);
    assert.equal(isComparable(undefined), false);
  });
  // Equal on both axes is not domination: neither item is a reason to discard the other.
  it('does not let an identical item dominate', () => assert.equal(dominates(p('a', 20000, 80), p('b', 20000, 80)), false));
  it('does not let a dearer, lower-scoring item dominate', () => assert.equal(dominates(p('a', 30000, 70), p('b', 20000, 80)), false));
});

describe('findDominatingItem names the most useful alternative', () => {
  it('returns nothing for an item nothing dominates', () => assert.equal(findDominatingItem(p('best', 20000, 90), [p('other', 30000, 80)]), null));
  it('returns nothing for an item that cannot be compared', () => assert.equal(findDominatingItem(p('nope', null, 90), [p('other', 10000, 95)]), null));
  it('never names the item itself', () => assert.equal(findDominatingItem(p('self', 20000, 80), [p('self', 20000, 80)]), null));
  // The highest-scoring dominator is the one worth naming in the UI, not whichever record happens
  // to come first in catalogue order.
  it('prefers the highest scoring dominator', () =>
    assert.equal(findDominatingItem(p('poor', 30000, 60), [p('ok', 20000, 70), p('great', 25000, 90)]).id, 'great'));
  it('breaks a tie on score by price', () =>
    assert.equal(findDominatingItem(p('poor', 30000, 60), [p('dear', 28000, 80), p('cheap', 20000, 80)]).id, 'cheap'));
});

describe('getParetoFrontier and markPareto on mixed input', () => {
  it('drops records that cannot be plotted', () =>
    assert.deepEqual(getParetoFrontier([p('a', 20000, 80), p('b', null, 95), p('c', 30000, null)]).map((c) => c.id), ['a']));
  it('returns nothing for an empty list', () => {
    assert.deepEqual(getParetoFrontier([]), []);
    assert.deepEqual(getParetoFrontier(), []);
  });
  it('marks an unplottable item as neither on the frontier nor dominated', () => {
    const [marked] = markPareto([p('pending', null, 95)]);
    assert.equal(marked.pareto, false);
    assert.equal(marked.dominatedBy, null);
  });
  it('names the dominator on a dominated item', () => {
    const marked = markPareto([p('cheapbest', 20000, 90), p('dearworse', 30000, 70)]);
    assert.equal(marked[0].pareto, true);
    assert.equal(marked[1].pareto, false);
    assert.equal(marked[1].dominatedBy.id, 'cheapbest');
  });
  it('reads the score off the key it is given', () => {
    const items = [{ id: 'a', name: 'a', purchasePrice: 20000, safetyScore: 90 }];
    assert.equal(markPareto(items, 'safetyScore')[0].pareto, true);
    assert.equal(markPareto(items, 'missingScore')[0].pareto, false);
  });
});

// The verdict on a dominance claim: the point estimates can say "outscored" while the price ranges
// overlap or the score gap sits inside the band that gives two items a shared rank, and a page that
// says both about one pair contradicts itself.
describe('markPareto qualifies the claim it makes about a dominated item', () => {
  const separation = () => ({ width: 5, coveredShare: 1 });
  it('calls a claim robust only when both the price interval and the band clear', () => {
    const [, dominated] = markPareto([p('a', 20000, 90), p('b', 30000, 70)], 'personalisedScore', { separation });
    assert.equal(dominated.dominance.verdict, 'robust');
  });
  it('calls it estimated when the score gap is inside the band', () => {
    const [, dominated] = markPareto([p('a', 20000, 74), p('b', 30000, 70)], 'personalisedScore', { separation });
    assert.equal(dominated.dominance.verdict, 'estimated');
  });
  // A band that covers only part of the visitor's weighting is a floor, and a floor cannot establish
  // a categorical claim; with no band at all the claim rests on the point estimates alone.
  it('calls it unquantified when the band it cleared covers only part of the weighting', () => {
    const partial = () => ({ width: 5, coveredShare: 0.6 });
    const [, dominated] = markPareto([p('a', 20000, 90), p('b', 30000, 70)], 'personalisedScore', { separation: partial });
    assert.equal(dominated.dominance.verdict, 'unquantified');
    assert.equal(markPareto([p('a', 20000, 90), p('b', 30000, 70)])[1].dominance.verdict, 'estimated');
  });
});

// An instance whose generator names the price interval differently binds its names once; until it
// does, the generic names are read, and a record carrying neither is a point at its price.
describe('the price interval fields are configurable', () => {
  it('reads the generic names by default, and a point price for a record without them', () => {
    assert.deepEqual(priceBounds({ purchasePrice: 100, priceLow: 90, priceHigh: 110 }), [90, 110]);
    assert.deepEqual(priceBounds({ purchasePrice: 100 }), [100, 100]);
  });
  it('reads the names an instance binds, and reports them', () => {
    const before = { ...PRICE_FIELDS };
    try {
      assert.deepEqual(configurePareto({ low: 'priceLowEur', high: 'priceHighEur' }), { low: 'priceLowEur', high: 'priceHighEur' });
      assert.deepEqual(priceBounds({ purchasePrice: 100, priceLowEur: 80, priceHighEur: 120, priceLow: 1 }), [80, 120]);
    } finally {
      configurePareto(before);
    }
  });
});
