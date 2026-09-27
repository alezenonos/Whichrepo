import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { snapshotDifferences } from '../node/snapshot-diff.mjs';

// A site changes its markup, a parser matches nothing, the refresh writes a *shorter* snapshot, and
// the assessor scores whatever survived. Nothing goes red. This is the comparison `--verify` reports
// from, so the quiet regression is named before anything is written.
describe('snapshotDifferences names what a re-read would change', () => {
  const figures = ['stars', 'battery_kwh'];
  const record = (id, selected, candidates) => ({ id, decision: { selected }, candidates });
  const c = (url, extra = {}) => ({ url, stars: 5, battery_kwh: 60, ...extra });
  const before = { records: [record('a', 'u1', [c('u1'), c('u2', { stars: 4 })]), record('b', 'u3', [c('u3')])] };

  it('says nothing when the crawl reproduces the snapshot', () => {
    assert.deepEqual(snapshotDifferences(before, structuredClone(before), { figures }), []);
  });
  it('reports a record that vanished and one that appeared', () => {
    const after = { records: [before.records[0], record('z', 'u9', [c('u9')])] };
    assert.deepEqual(snapshotDifferences(before, after, { figures }), ['b: no longer in the snapshot', 'z: new in the snapshot']);
  });
  it('reports a moved selection and a changed candidate count', () => {
    const after = { records: [record('a', 'u2', [c('u2', { stars: 4 })]), before.records[1]] };
    assert.deepEqual(snapshotDifferences(before, after, { figures }), ['a: selection u1 -> u2; 2 -> 1 candidates; u1 dropped']);
  });
  // A figure that moves while the selection does not is the quietest regression of the three.
  it('reports a figure that moved under an unchanged selection, by name', () => {
    const after = { records: [record('a', 'u1', [c('u1', { battery_kwh: null }), c('u2', { stars: 4 })]), before.records[1]] };
    assert.deepEqual(snapshotDifferences(before, after, { figures }), ['a: u1 battery_kwh 60 -> none']);
  });
  // Twenty candidates becoming a different twenty at the same count under an unchanged selection
  // reported nothing until the churn itself was named.
  it('names candidate churn at an unchanged count', () => {
    const after = { records: [record('a', 'u1', [c('u1'), c('u7', { stars: 4 })]), before.records[1]] };
    assert.deepEqual(snapshotDifferences(before, after, { figures }), ['a: candidates u2 replaced by u7']);
  });
  it('compares only the figures it is given, and reads either selection spelling', () => {
    const after = { records: [record('a', 'u1', [c('u1', { stars: 1 }), c('u2', { stars: 4 })]), before.records[1]] };
    assert.deepEqual(snapshotDifferences(before, after, { figures: ['battery_kwh'] }), []);
    const spelt = { records: [{ id: 'a', decision: { selected_url: 'u1' }, candidates: [c('u1')] }] };
    assert.deepEqual(snapshotDifferences(spelt, { records: [{ id: 'a', decision: { selected: 'u1' }, candidates: [c('u1')] }] }, { figures }), []);
  });
});
