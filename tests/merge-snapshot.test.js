// What a refresher is allowed to write over a committed evidence snapshot.
//
// Three of the crawlers rebuild their whole file rather than editing records in place, and all three
// had the same defect: `--only=id` filtered the records it read and then wrote that filtered list
// out as the entire snapshot. The Parkers specification refresher was fixed for it in August 2026 --
// reproduced at 97 records in, 1 record out -- and the fix was never carried to the two crawlers
// holding the largest snapshots. `data/consumption-results.yaml` is what puts 93 records on a
// measured Cyprus running cost and `data/luxury-spec.yaml` is what puts 118 on a read equipment
// list; a targeted re-read of one record deleted the rest of both, and the next `npm run assess`
// moved every one of those records onto a fitted prediction or the no-evidence anchor without a
// single test going red.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeSnapshotRecords, orderSnapshotRecords, refuseEmptyFullRun, stampVerified } from '../node/merge-snapshot.mjs';

describe('a targeted refresh merges rather than replaces', () => {
  const committed = [
    { id: 'a', figure: 1 },
    { id: 'b', figure: 2 },
    { id: 'c', figure: 3 },
  ];

  it('keeps every record the run did not ask for', () => {
    const merged = mergeSnapshotRecords(committed, [{ id: 'b', figure: 22 }], ['b']);
    assert.deepEqual(merged.map((record) => record.id), ['a', 'b', 'c']);
    assert.equal(merged.find((record) => record.id === 'b').figure, 22);
    assert.equal(merged.find((record) => record.id === 'c').figure, 3);
  });

  // A full run is the authority on which records still have a reading, so it may shrink the file --
  // a record whose source stopped publishing has to lose its figure rather than keep a stale one.
  it('lets a full run drop a record it no longer reads', () => {
    assert.deepEqual(
      mergeSnapshotRecords(committed, [{ id: 'a', figure: 1 }], null).map((record) => record.id),
      ['a'],
    );
  });

  // Reading *less* is a demotion; reading *nothing* is a broken crawl wearing the same clothes.
  it('refuses to empty a populated snapshot from a full run that read nothing', () => {
    assert.throws(() => mergeSnapshotRecords(committed, [], null), /read no records/);
    assert.throws(() => refuseEmptyFullRun(3, 0, null), /read no records/);
  });

  it('writes an empty snapshot when there was nothing committed to lose', () => {
    assert.deepEqual(mergeSnapshotRecords([], [], null), []);
    assert.doesNotThrow(() => refuseEmptyFullRun(0, 0, null));
  });

  // The consumption and luxury snapshots are committed in catalogue order, not alphabetically.
  // Making the two paths agree by sorting them alphabetically would have rewritten all 136 records
  // on the next full run and buried the one line that changed -- the same harm the sort exists to
  // prevent, arriving from the other side. Both paths take the catalogue's own order instead.
  it('reproduces the committed order from a partial run and a full one alike', () => {
    const order = ['c', 'a', 'b'];
    const full = mergeSnapshotRecords(committed, committed, null, { order });
    const partial = mergeSnapshotRecords(committed, [{ id: 'a', figure: 11 }], ['a'], { order });
    assert.deepEqual(full.map((record) => record.id), ['c', 'a', 'b']);
    assert.deepEqual(partial.map((record) => record.id), ['c', 'a', 'b']);
  });

  it('puts a record the catalogue order does not name at the end rather than anywhere', () => {
    const ordered = orderSnapshotRecords([{ id: 'z' }, { id: 'b' }, { id: 'a' }], ['b', 'a']);
    assert.deepEqual(ordered.map((record) => record.id), ['b', 'a', 'z']);
  });
});

// #98 and #99: a record the run tried to read and could not. Neither a reading nor a withdrawal, and
// before `{ read, unread }` it had nowhere to go. The consumption crawler emitted an empty record for
// it, dated today, which replaced the committed one on a full run and under `--only` alike -- a 429
// during a full refresh would have moved every record onto the editorial fallback and reported the
// snapshot as freshly read. The dimensions crawler left it out, so a full run, which starts from
// nothing, dropped it: one 429 silently removed that record's width and turning diameter from
// Manageability.
describe('a record that could not be read is carried, never replaced or dropped', () => {
  const committed = [
    { id: 'a', accessed: '2026-08-01', candidates: [{ url: 'u1', consumption_l_100km: 6.1 }] },
    { id: 'b', accessed: '2026-08-01', width_mm: 1900 },
    { id: 'c', accessed: '2026-08-01', width_mm: 1850 },
  ];

  it('keeps a consumption record whose read failed, with its candidates and its old date, on a full run', () => {
    const merged = mergeSnapshotRecords(committed, { read: [{ id: 'b', accessed: '2026-09-25', width_mm: 1901 }, { id: 'c', accessed: '2026-09-25', width_mm: 1850 }], unread: ['a'] }, null);
    assert.deepEqual(merged.find((record) => record.id === 'a'), committed[0]);
    assert.equal(merged.find((record) => record.id === 'b').width_mm, 1901);
  });

  it('keeps it under --only as well', () => {
    const merged = mergeSnapshotRecords(committed, { read: [], unread: ['a'] }, ['a']);
    assert.deepEqual(merged, committed);
  });

  it('keeps a dimensions record whose page failed on a full run, with its old date', () => {
    const merged = mergeSnapshotRecords(committed, { read: [{ id: 'a', accessed: '2026-09-25', candidates: [] }, { id: 'c', accessed: '2026-09-25', width_mm: 1850 }], unread: ['b'] }, null);
    assert.equal(merged.length, 3, 'a full run with one failed page keeps the record count');
    assert.deepEqual(merged.find((record) => record.id === 'b'), committed[1]);
  });

  // The guard that could never fire for the consumption crawler: a total outage emitted one entry per
  // record and so counted as a full read.
  it('counts only what was read when deciding whether a full run read anything', () => {
    assert.throws(() => mergeSnapshotRecords(committed, { read: [], unread: ['a', 'b', 'c'] }, null), /read no records at all/);
  });

  // A full run is still the authority on records it did not try to read: one no longer selected is
  // dropped, as before. Only an attempted-and-failed read is carried.
  it('still lets a full run drop a record it did not attempt', () => {
    const merged = mergeSnapshotRecords(committed, { read: [{ id: 'a', accessed: '2026-09-25' }], unread: ['b'] }, null);
    assert.deepEqual(merged.map((record) => record.id), ['a', 'b']);
  });

  it('refuses a record reported as both read and unread', () => {
    assert.throws(() => mergeSnapshotRecords(committed, { read: [{ id: 'a' }], unread: ['a'] }, null), /both read and unread/);
  });

  it('carries nothing for an unread record that was never committed', () => {
    assert.deepEqual(mergeSnapshotRecords([], { read: [{ id: 'a' }], unread: ['z'] }, null), [{ id: 'a' }]);
  });
});


// `--verify` has been in this crawler's usage banner since it was written and nothing ever read the
// flag, so `node data/refresh-luxury-spec.mjs --verify` fell straight through to the write path and
// overwrote the frozen snapshot with a fresh crawl. A verify mode that writes is worse than no
// verify mode: it is the one command in the repository whose whole promise is that it changes
// nothing, and CLAUDE.md tells a reader to run it before trusting any rewrite.

// The third failure mode, found on 15 August 2026 by the powertrain pass and distinct from the two
// this module was written for. Those are both "we could not read it" — and the rule there is that a
// committed reading survives. This one is "the basis for reading it has been withdrawn", and the
// committed reading must not survive.
//
// `refresh-parkers-specs.mjs` reads wheelbase and WLTP consumption from whichever trim page the
// Luxury pass established as the priced trim, and only from a `priced_trim` basis — a stand-in is
// explicitly refused there, because reading economy off the Defender's 635 PS Octa stand-in would
// publish a figure for a car nobody is buying. When the powertrain rule withdrew the priced trim
// from the Jeep Compass and the Porsche Cayenne Electric, both dropped out of the eligible set, so
// neither was re-read — and the merge carried their old readings forward untouched. The Compass
// kept a wheelbase and a consumption figure read from a 1.2 e-Hybrid mild hybrid while the record
// prices a 4xe plug-in hybrid, and the Cayenne Electric kept figures read from a petrol coupe.
describe('a withdrawn reading is removed rather than carried forward', () => {
  const committed = [
    { id: 'a', url: 'a-se', wheelbase_mm: 2600 },
    { id: 'b', url: 'b-se', wheelbase_mm: 2700 },
    { id: 'c', url: 'c-se', wheelbase_mm: 2800 },
  ];

  it('drops a named record whose basis was withdrawn, on a partial run', () => {
    const merged = mergeSnapshotRecords(committed, [{ id: 'a', url: 'a-phev', wheelbase_mm: 2610 }], ['a', 'b'], { withdraw: ['b'] });
    assert.deepEqual(merged.map((record) => record.id), ['a', 'c'], 'b was withdrawn, c was never in scope and stands');
    assert.equal(merged.find((record) => record.id === 'a').url, 'a-phev');
  });

  it('leaves a record alone when it was not withdrawn', () => {
    const merged = mergeSnapshotRecords(committed, [], ['b'], { withdraw: [] });
    assert.deepEqual(merged.map((record) => record.id), ['a', 'b', 'c']);
  });

  // A withdrawal is a statement about a named record, so it must never be the thing that empties a
  // snapshot -- the failure this module already refuses for a full run that read nothing.
  it('refuses to withdraw every record at once', () => {
    // A partial run naming every id, so the empty-full-run guard is not what catches it: this is the
    // withdrawal guard's own case. An eligibility rule that suddenly considers nothing eligible is a
    // broken rule wearing the same clothes as a catalogue with nothing left to read.
    assert.throws(() => mergeSnapshotRecords(committed, [], ['a', 'b', 'c'], { withdraw: ['a', 'b', 'c'] }), /every committed record/);
  });
});

// The other half of the same question: what a refresher is allowed to write on a `--verify` run.
//
// The answer was "nothing", and that was almost right. A re-read that quietly rewrites the snapshot
// is how a parser that stopped matching gets published as a catalogue that stopped publishing, so
// verify returns before writing any reading. But it wrote no *trace* either, and
// `data/audit-freshness.mjs` is what showed that to be a defect: it reported 112 of 122 luxury
// records as predating a gate that governs them, when a pass had verified all 136 and found three
// differences. The 94 records that pass proved correct still carried their original `accessed` date,
// so the audit and the record of the pass contradicted each other — and the audit is the one a new
// session runs first.
describe('a verify run leaves a trace without writing a reading', () => {
  const committed = [
    { id: 'a', accessed: '2026-08-10', reading: 'unchanged' },
    { id: 'b', accessed: '2026-08-10', reading: 'moved' },
    { id: 'c', accessed: '2026-08-10', reading: 'not in this run' },
  ];

  it('stamps only the records that reproduced, and touches no reading', () => {
    const stamped = stampVerified(committed, ['a'], ['a', 'b'], '2026-08-28');
    assert.deepEqual(stamped, [
      { id: 'a', accessed: '2026-08-10', reading: 'unchanged', verified_at: '2026-08-28' },
      { id: 'b', accessed: '2026-08-10', reading: 'moved' },
      { id: 'c', accessed: '2026-08-10', reading: 'not in this run' },
    ]);
  });

  // `--only` verifies a subset. A record this run never looked at must keep whatever it had, for the
  // same reason a partial write must merge rather than replace: the run has no evidence about it.
  it('leaves a record the run did not check exactly as it was', () => {
    const withStamp = [{ id: 'c', accessed: '2026-08-10', verified_at: '2026-08-20' }];
    assert.deepEqual(stampVerified(withStamp, [], [], '2026-08-28'), withStamp);
  });

  // A stamp is a claim that the committed reading still reproduces. Once it does not, the claim is
  // false about the page as it stands, and leaving it would read as a clean bill of health for a
  // record that has just been shown to have moved.
  it('withdraws a stale stamp from a record that has since diverged', () => {
    const stamped = stampVerified(
      [{ id: 'b', accessed: '2026-08-10', verified_at: '2026-08-20', reading: 'moved' }],
      [],
      ['b'],
      '2026-08-28',
    );
    assert.deepEqual(stamped, [{ id: 'b', accessed: '2026-08-10', reading: 'moved' }]);
  });
});
