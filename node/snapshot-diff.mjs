// Compares a freshly crawled evidence snapshot against the committed one, so a refresher can report
// what a re-read would change before it writes anything.
//
// This exists because two of the crawlers had no `--verify` mode. The editorial and reliability
// refreshers re-read and report; consumption and Euro NCAP only ever rewrote. The luxury refresher
// was counted here as re-reading and reporting and did not: it advertised `--verify` in its usage
// banner and read the flag nowhere, so the command fell through to the write path and overwrote the
// snapshot it was asked to check. It has its own comparison now, over equipment sets. Their
// failure mode is the quiet one this repository keeps finding: a site changes its markup, a parser
// matches nothing, the refresh writes a *shorter* snapshot, and `npm run assess` scores whatever
// survived. Nothing goes red, and the diff looks like an ordinary data update. The electric
// consumption label had been unmatched on all 803 pages for exactly this reason.
//
// Both snapshots carry the same shape -- a record with the decision it reached and the candidates it
// chose between -- so one comparison serves both. Euro NCAP names its chosen result `selected_url`
// where consumption names it `selected`; both are read.

// Which figures a candidate can carry is the instance's knowledge, not this module's: it is passed in
// as `figures`, and an instance derives the list from the same schema module its crawler stores
// figures with, so a figure the crawler can store is a figure this compares, by construction.
export const defaultSelectionOf = (record) =>
  record?.decision?.selected ?? record?.decision?.selected_url ?? null;

// A whole-snapshot regression can drop hundreds of candidates at once, and a report that prints
// every URL is a report nobody reads. Three names and a count is enough to tell a reviewer what
// kind of change they are looking at.
const LISTED_URLS = 3;
const list = (urls) =>
  urls.length > LISTED_URLS
    ? `${urls.slice(0, LISTED_URLS).join(', ')} and ${urls.length - LISTED_URLS} more`
    : urls.join(', ');

export function snapshotDifferences(previous, next, { figures = [], selectionOf = defaultSelectionOf } = {}) {
  const before = new Map((previous?.records ?? []).map((record) => [record.id, record]));
  const after = new Map((next?.records ?? []).map((record) => [record.id, record]));
  const differences = [];

  for (const [id, old] of before) {
    const fresh = after.get(id);
    if (!fresh) {
      differences.push(`${id}: no longer in the snapshot`);
      continue;
    }
    const notes = [];
    const wasSelected = selectionOf(old);
    const nowSelected = selectionOf(fresh);
    if (wasSelected !== nowSelected) {
      notes.push(`selection ${wasSelected ?? 'none'} -> ${nowSelected ?? 'none'}`);
    }
    const oldUrls = (old.candidates ?? []).map((candidate) => candidate.url);
    const newUrls = (fresh.candidates ?? []).map((candidate) => candidate.url);
    if (oldUrls.length !== newUrls.length) notes.push(`${oldUrls.length} -> ${newUrls.length} candidates`);
    // A count alone cannot say *which* pages a re-read is now looking at. Figures below are
    // compared only for candidates whose URL survived, so a re-crawl that swapped every candidate
    // for a different URL at the same count, under an unchanged selection, reported nothing at all
    // -- which is exactly the silent parser change this module exists to catch. Naming the churn
    // also covers the case a changed count does not: 20 candidates becoming a different 20.
    const dropped = oldUrls.filter((url) => !newUrls.includes(url));
    const added = newUrls.filter((url) => !oldUrls.includes(url));
    if (dropped.length && added.length) notes.push(`candidates ${list(dropped)} replaced by ${list(added)}`);
    else if (dropped.length) notes.push(`${list(dropped)} dropped`);
    else if (added.length) notes.push(`${list(added)} added`);
    if (notes.length) differences.push(`${id}: ${notes.join('; ')}`);

    // A figure that moves while the selection does not is the quietest regression of the three, and
    // the one a candidate count cannot show.
    const freshByUrl = new Map((fresh.candidates ?? []).map((candidate) => [candidate.url, candidate]));
    for (const candidate of old.candidates ?? []) {
      const now = freshByUrl.get(candidate.url);
      if (!now) continue;
      for (const figure of figures) {
        const was = candidate[figure] ?? null;
        const is = now[figure] ?? null;
        if (was !== is)
          differences.push(`${id}: ${candidate.url} ${figure} ${was ?? 'none'} -> ${is ?? 'none'}`);
      }
    }
  }

  for (const id of after.keys()) if (!before.has(id)) differences.push(`${id}: new in the snapshot`);
  return differences;
}
