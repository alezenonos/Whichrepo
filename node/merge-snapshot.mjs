// Writing a re-crawled evidence snapshot back over the committed one, for the three refreshers that
// rebuild their whole file rather than editing records in place.
//
// Two failure modes, both of which have happened here, and both of which look like an ordinary data
// update in the diff:
//
//   `--only=id` re-reads a subset and then writes *only* what it re-read, deleting every other
//   committed reading. Reproduced at 97 records in, 1 record out in the Parkers specification
//   refresher, and still live in the consumption and luxury refreshers until this module existed.
//   The next `npm run assess` scores whatever survived, and nothing goes red.
//
//   A full run whose parser matched nothing writes an empty snapshot. On the page that is
//   indistinguishable from "no record publishes this any more", which is this repository's recurring
//   pair: the source published nothing, or we could not read the source. Emptying a populated
//   snapshot has to be a decision someone makes, not one a crawl makes silently.
//
// So: a partial run merges onto the committed records, a full run is the authority on which records
// still have a reading and may shrink the snapshot -- but never to nothing.
//
// Both paths order the result the same way, so a partial run and a full run of the same catalogue
// produce identical files and the diff shows the one line that moved. `order` is how: the
// consumption and luxury snapshots are committed in catalogue order, and re-sorting them
// alphabetically to make the two paths agree would rewrite every record on the next full run --
// the same "bury the change history" harm, arriving from the other side. Pass the catalogue's own
// id order and both paths reproduce the committed file. Without it the order is alphabetical, which
// is what the Parkers specification snapshot is already committed in.
// A record the order does not name still has to land somewhere deterministic rather than wherever
// the Map happened to put it, so it sorts to the end by id.
export function orderSnapshotRecords(records, order = null) {
  const rank = order ? new Map(order.map((id, index) => [id, index])) : null;
  return [...records].sort((a, b) =>
    rank
      ? (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id)
      : a.id.localeCompare(b.id),
  );
}

export function refuseEmptyFullRun(committedCount, refreshedCount, selectedIds, hint = '') {
  if (!selectedIds && !refreshedCount && committedCount)
    throw new Error(
      `A full refresh read no records at all while ${committedCount} are committed. That is a broken ` +
        `crawl, not a catalogue with nothing left to read.${hint ? ` ${hint}` : ''}`,
    );
}

// A third case, and it is neither of the two above. Those are both "we could not read it", where the
// committed reading survives. `withdraw` is "the basis for reading it has been withdrawn", where it
// must not.
//
// The Parkers specification refresher reads only from a trim the Luxury pass established as the
// priced trim, and refuses a stand-in outright. When the powertrain rule withdrew the priced trim
// from the Jeep Compass and the Porsche Cayenne Electric, both left the eligible set, so neither was
// re-read -- and the merge carried their old readings forward. The Compass kept a wheelbase and a
// WLTP consumption read from a 1.2 mild hybrid while the record prices a 4xe plug-in hybrid. A
// record that is no longer eligible has to lose its reading, exactly as a full run drops a record
// its source stopped publishing.
//
// And a fourth, which is the one #98 and #99 were: a record the run tried to read and could not. It
// is neither a reading nor a withdrawal, and until this took `{ read, unread }` it had nowhere to go.
// The dimensions crawler left it out of `refreshed`, so a full run -- which starts from nothing --
// dropped it: five 429s removed five records' width and turning diameter from Manageability. The
// consumption crawler put an empty record in `refreshed` instead, dated today, so either kind of run
// replaced a measured Cyprus bill with nothing and the freshness audit called it newly read. And
// because one entry was emitted per record whether it was read or not, the empty-run guard above
// could never fire for that crawler: a total outage counted as 136 records read.
//
// So `refreshed` may be `{ read, unread }`. An unread id is always carried from `committed`, on a
// full run as well as a partial one, byte for byte and with its old date; and the empty-run guard
// counts `read` alone. A plain array is still accepted and means "everything here was read".
export function mergeSnapshotRecords(
  committed,
  refreshed,
  selectedIds,
  { hint = '', order = null, withdraw = [] } = {},
) {
  const { read, unread } = Array.isArray(refreshed)
    ? { read: refreshed, unread: [] }
    : { read: refreshed?.read ?? [], unread: refreshed?.unread ?? [] };
  const unreadIds = new Set(unread.map((entry) => (typeof entry === 'string' ? entry : entry?.id)));
  // A record both read and unread is a caller that lost track of its own outcomes, and whichever
  // side won here would be a guess.
  const both = read.filter((record) => unreadIds.has(record.id)).map((record) => record.id);
  if (both.length) throw new Error(`A refresh reported ${both.join(', ')} as both read and unread.`);
  refuseEmptyFullRun((committed ?? []).length, read.length, selectedIds, hint);
  refreshed = read;
  const withdrawn = new Set(withdraw);
  // Withdrawing everything is the same shape of accident as a full run that read nothing: a rule
  // that suddenly considers no record eligible is a broken rule, not a catalogue with nothing left.
  if (
    withdrawn.size &&
    (committed ?? []).length &&
    (committed ?? []).every((record) => withdrawn.has(record.id))
  )
    throw new Error(
      `A refresh withdrew every committed record at once (${withdrawn.size} of ${(committed ?? []).length}). ` +
        `That is a broken eligibility rule, not a catalogue with nothing left to read.${hint ? ` ${hint}` : ''}`,
    );
  const refreshedById = new Map(refreshed.map((record) => [record.id, record]));
  const committedById = new Map((committed ?? []).map((record) => [record.id, record]));
  const merged = selectedIds ? new Map(committedById) : new Map();
  for (const id of unreadIds) if (committedById.has(id)) merged.set(id, committedById.get(id));
  for (const id of withdrawn) merged.delete(id);
  for (const [id, record] of refreshedById) merged.set(id, record);
  return orderSnapshotRecords([...merged.values()], order);
}

// The trace a `--verify` run leaves behind, added 2026-08-28.
//
// `--verify` re-reads every page and reports where the parser and the committed snapshot disagree.
// It returns before writing, deliberately: a re-read that quietly rewrites the file is how a parser
// that stopped matching gets published as a catalogue that stopped publishing. But that also meant a
// verify run left no trace at all, so nothing downstream could tell a record proved correct
// yesterday from one nobody has looked at since it was first crawled.
//
// `audit-freshness.mjs` is what noticed. It reported 112 of 122 luxury records as predating a gate
// that governs them, when a pass had verified all 136 and found three differences -- the 94 it
// proved correct still carried their original `accessed` date, because verify had returned before
// writing. The audit and the record of that pass contradicted each other, and the audit is the one a
// new session runs first.
//
// So verify writes exactly one thing: the date each record was last shown to still reproduce. It
// never touches a reading, which is the property that makes verify trustworthy -- a record that
// differs does not get stamped, and loses any stamp it had, because its old verification no longer
// describes the page. `accessed` still means "the day this evidence was read"; `verified_at` means
// "the day it was last confirmed unchanged", and they are different facts about different events.
export function stampVerified(records, verifiedIds, checkedIds, date) {
  const verified = new Set(verifiedIds);
  const checked = new Set(checkedIds);
  return records.map((record) => {
    if (!checked.has(record.id)) return record;
    if (verified.has(record.id)) return { ...record, verified_at: date };
    // Checked and differed. The stamp it carried was true of a page that has since moved, so it is
    // removed rather than left to read as a clean bill of health for the reading that replaced it.
    const { verified_at: _dropped, ...rest } = record;
    return rest;
  });
}
