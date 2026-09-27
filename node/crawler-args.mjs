// One reading of `--only` for every crawler that has one.
//
// The defect this closes had been recorded as a trap to remember rather than fixed:
// `refresh-luxury-spec.mjs` took `--only <ids>` while every other reader took `--only=<ids>`, and
// passing the wrong form did not fail. It fell through to "no filter" and crawled the whole
// catalogue -- on the slowest reader in the repository, the one whose `--verify` opens every trim
// page. Silence is the whole defect. A filter that is ignored looks exactly like a filter that
// matched everything, and this project already has the expensive version of that story: `--only`
// once wrote a snapshot containing only the re-read records and took a file from 97 records to 1.
//
// So both spellings are accepted, and anything that looks like an attempt to filter and is not one
// throws. A crawler cannot be asked to restrict itself and quietly not.

const FLAG = '--only';

// Thrown rather than returned, because every caller's correct response is the same: stop. A partial
// crawl started from a misunderstood argument writes a snapshot nobody asked for.
export class CrawlerArgumentError extends Error {}

// `--only=a,b`, `--only a,b`, or absent. Returns null for absent -- meaning "no filter", the only
// state in which a full crawl is intended -- and a non-empty array otherwise.
//
// `--only` with nothing after it is the case that matters. It is what a shell expands an empty
// variable to (`--only=$IDS` with `IDS` unset becomes `--only=`), and reading it as "no filter" is
// how an intended one-record re-read becomes a full crawl.
export function parseOnly(argv = []) {
  const args = [...argv];
  const inline = args.find((argument) => argument.startsWith(`${FLAG}=`));
  const separateAt = args.indexOf(FLAG);

  if (inline !== undefined && separateAt !== -1)
    throw new CrawlerArgumentError(
      `${FLAG} was given twice, as ${inline} and as a separate argument. Pass it once.`,
    );

  let raw = null;
  if (inline !== undefined) raw = inline.slice(`${FLAG}=`.length);
  else if (separateAt !== -1) {
    const next = args[separateAt + 1];
    if (next === undefined || next.startsWith('-'))
      throw new CrawlerArgumentError(
        `${FLAG} was given with no ids after it. Pass ${FLAG}=id,id or ${FLAG} id,id.`,
      );
    raw = next;
  } else return null;

  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (!ids.length)
    throw new CrawlerArgumentError(
      `${FLAG} was given with no ids in it (${JSON.stringify(raw)}), which would crawl the whole catalogue. Pass ids, or omit ${FLAG} to mean every record.`,
    );
  return ids;
}

// What a crawler's `main` does with the above: report the misuse and stop, without a stack trace
// that buries the one line the operator needs.
const stop = (message) => {
  console.error(message);
  process.exit(2);
};

export function readOnly(argv = [], fail = stop) {
  try {
    return parseOnly(argv);
  } catch (error) {
    if (!(error instanceof CrawlerArgumentError)) throw error;
    return fail(error.message);
  }
}

// The same rule one step later: every id `--only` names must be one this crawler can read. Raised in
// review on #172. Each crawler filtered its catalogue by the ids and never asked whether any matched,
// so `--only=kia-sportgae` selected nothing, read nothing, changed nothing and exited 0 -- the
// operator was told the refresh ran. That is the ignored-filter defect above in its other form: a
// filter that matches nothing looks exactly like a record whose evidence did not change. Checked
// before any page is read, against the ids the crawler actually walks (records, variants or trims).
export function checkOnlyIds(
  only,
  known,
  { what = 'record', fail = stop, catalogue = 'the catalogue' } = {},
) {
  if (!only) return only;
  const available = new Set(known);
  const unknown = only.filter((id) => !available.has(id));
  if (!unknown.length) return only;
  return fail(
    `${FLAG} names ${unknown.length === 1 ? 'an id' : `${unknown.length} ids`} this crawler has no ${what} for: ` +
      `${unknown.join(', ')}. Nothing was read. Check the spelling against ${catalogue}.`,
  );
}

// What a crawler's exit status says, in one place. #104.
//
// `CLAUDE.md` makes `--verify` the precondition for trusting a rewrite, and the only thing a script
// or a scheduled job reads of a verify is its exit status. Four crawlers returned success from verify
// whether or not a page failed to read or a reading differed -- the editorial one set
// `process.exitCode = 0` outright -- so `node data/refresh-x.mjs --verify && node data/refresh-x.mjs`
// went on to write after a verification that had failed. The Euro NCAP and dimensions crawlers had the
// rule right, in two different spellings. It lives here now, once.
//
//   `failed`   pages or records that could not be read. Non-zero in every mode: a write that could
//              not read part of its source is incomplete, even though it keeps the committed readings
//              it could not replace, and must not report success.
//   `changed`  differences against the committed snapshot. Passed by `--verify` only: in verify a
//              difference is the finding, while in a write it is the point of running.
//
// Both are counts or lists. An absent `failed` throws rather than reading as zero, because a caller
// that forgot to pass it would otherwise exit 0 on every run -- absence becoming zero, the defect
// this repository has already published a 0 L boot and a 0 g/km petrol car through.
const countOf = (name, value) => {
  if (Array.isArray(value)) return value.length;
  if (Number.isInteger(value) && value >= 0) return value;
  throw new TypeError(
    `exitCodeFor needs \`${name}\` as a count or a list and was given ${JSON.stringify(value)}. An absent count is not zero.`,
  );
};

export function exitCodeFor({ failed, changed = 0 } = {}) {
  return countOf('failed', failed) || countOf('changed', changed) ? 1 : 0;
}

// The file-level `snapshot:` date says when the snapshot was last read *in full*. A partial run
// (`--only`) or one that could not read every page has not refreshed the snapshot, and stamping it
// anyway publishes an outage as freshness on the line `audit-freshness.mjs` reads. Euro NCAP had this
// rule; the editorial, reliability, consumption and Parkers specification refreshers restamped the
// date on every write (#102).
export function snapshotDate({ committed, today, only = null, failed }) {
  return !only && countOf('failed', failed) === 0 ? today : (committed ?? today);
}
