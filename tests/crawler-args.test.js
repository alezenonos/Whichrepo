import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CrawlerArgumentError, checkOnlyIds, exitCodeFor, parseOnly, readOnly, snapshotDate } from '../node/crawler-args.mjs';

// The defect this pins had been recorded in `docs/status.md` as a trap to remember rather than
// fixed: "`refresh-luxury-spec.mjs` takes `--only <ids>`, every other crawler takes `--only=<ids>`.
// Passing the wrong form does not fail -- it silently crawls the whole catalogue."
//
// Silence is the whole defect. `argv.includes('--only')` is false for `--only=kia-ev3`, so the
// filter fell through to null and the slowest reader in the repository -- the one whose `--verify`
// opens every trim page of every record -- read all 136 instead of the one it was asked for. A
// filter that is ignored looks exactly like a filter that matched everything.

describe('a crawler cannot be asked to restrict itself and quietly not', () => {
  it('reads both spellings, because both were in use', () => {
    assert.deepEqual(parseOnly(['--only=kia-ev3']), ['kia-ev3']);
    assert.deepEqual(parseOnly(['--only', 'kia-ev3']), ['kia-ev3']);
    assert.deepEqual(parseOnly(['--only=kia-ev3,volvo-ex30']), ['kia-ev3', 'volvo-ex30']);
    assert.deepEqual(parseOnly(['--only', 'kia-ev3,volvo-ex30']), ['kia-ev3', 'volvo-ex30']);
  });

  // The exact case that was silent. Before this, `refresh-luxury-spec.mjs` read this as "no filter".
  it('does not read the other spelling as a request to crawl everything', () => {
    for (const argv of [['--only=kia-ev3'], ['--only', 'kia-ev3'], ['--verify', '--only=kia-ev3']])
      assert.notEqual(parseOnly(argv), null, `${argv.join(' ')} asked for a filter and got none`);
  });

  // Absence is the only state in which a full crawl is intended, and it has to be stated by leaving
  // the flag off rather than by passing an empty one.
  it('means every record only when nothing was asked for', () => {
    assert.equal(parseOnly([]), null);
    assert.equal(parseOnly(['--verify']), null);
    assert.equal(parseOnly(['--dry-run', '--audit']), null);
  });

  // `--only=$IDS` with the variable unset expands to `--only=`, and reading that as "no filter" is
  // how an intended one-record re-read becomes a full crawl of a publication.
  it('refuses an empty filter rather than treating it as no filter', () => {
    for (const argv of [['--only='], ['--only', ','], ['--only=,,'], ['--only=  ']])
      assert.throws(() => parseOnly(argv), CrawlerArgumentError, `${JSON.stringify(argv)} was accepted`);
  });

  it('refuses a flag with nothing after it, and never eats the next flag as an id', () => {
    assert.throws(() => parseOnly(['--only']), CrawlerArgumentError);
    assert.throws(() => parseOnly(['--only', '--verify']), CrawlerArgumentError);
    assert.throws(() => parseOnly(['--verify', '--only']), CrawlerArgumentError);
  });

  it('refuses both spellings at once rather than picking one', () => {
    assert.throws(() => parseOnly(['--only=a', '--only', 'b']), CrawlerArgumentError);
  });

  it('trims ids, because a shell-quoted list carries spaces', () => {
    assert.deepEqual(parseOnly(['--only=kia-ev3, volvo-ex30 ']), ['kia-ev3', 'volvo-ex30']);
  });

  // What the operator sees. A stack trace buries the one line that says what to type.
  it('reports the misuse and stops, rather than throwing past the caller', () => {
    const said = [];
    const result = readOnly(['--only'], (message) => {
      said.push(message);
      return 'stopped';
    });
    assert.equal(result, 'stopped');
    assert.match(said[0], /--only=id,id/, 'the message must say what to type instead');
  });

  it('lets a real error through rather than swallowing it as a usage problem', () => {
    assert.throws(
      () =>
        readOnly(
          {
            // Not an array: `find` is missing, so this throws a TypeError rather than a usage error.
            length: 1,
          },
          () => 'swallowed',
        ),
      (error) => !(error instanceof CrawlerArgumentError),
    );
  });
});


// #104. Four crawlers' `--verify` exited 0 whether or not a page failed to read or a reading differed
// -- the editorial one assigned `process.exitCode = 0` outright -- so `refresh-x --verify && refresh-x`
// wrote after a verification that had failed. The rule lives once now, and these are its four cases.
describe('exitCodeFor', () => {
  it('is 0 only when every page was read and nothing moved', () => {
    assert.equal(exitCodeFor({ failed: 0, changed: 0 }), 0);
  });

  it('is 1 when a reading differs', () => {
    assert.equal(exitCodeFor({ failed: 0, changed: 3 }), 1);
  });

  it('is 1 when a page could not be read, even though nothing differs', () => {
    assert.equal(exitCodeFor({ failed: 1, changed: 0 }), 1);
  });

  it('is 1 when both happened', () => {
    assert.equal(exitCodeFor({ failed: 2, changed: 5 }), 1);
  });

  it('accepts the lists a crawler already holds', () => {
    assert.equal(exitCodeFor({ failed: [], changed: [] }), 0);
    assert.equal(exitCodeFor({ failed: ['a: HTTP 503'], changed: [] }), 1);
  });

  // A write run passes no `changed`: there a difference is the point of running, not a failure.
  it('judges a write run by its failures alone', () => {
    assert.equal(exitCodeFor({ failed: 0 }), 0);
    assert.equal(exitCodeFor({ failed: 4 }), 1);
  });

  // A caller that forgot `failed` would exit 0 on every run. Absence is not zero.
  it('refuses an absent or malformed count rather than reading it as zero', () => {
    assert.throws(() => exitCodeFor({ changed: 0 }), /absent count is not zero/);
    assert.throws(() => exitCodeFor({ failed: null }), TypeError);
    assert.throws(() => exitCodeFor({ failed: -1 }), TypeError);
    assert.throws(() => exitCodeFor({ failed: 0, changed: '2' }), TypeError);
  });
});


// #102. A run that could not read every page, or read only `--only`, has not refreshed the snapshot.
// The editorial refresher restamped `snapshot:` on every write, including a two-record `--only` run,
// and that is the line `audit-freshness.mjs` reads to decide whether the file is current.
describe('snapshotDate', () => {
  it('advances only on a complete, full run', () => {
    assert.equal(snapshotDate({ committed: '2026-08-18', today: '2026-09-25', only: null, failed: 0 }), '2026-09-25');
    assert.equal(snapshotDate({ committed: '2026-08-18', today: '2026-09-25', only: ['a'], failed: 0 }), '2026-08-18');
    assert.equal(snapshotDate({ committed: '2026-08-18', today: '2026-09-25', only: null, failed: 1 }), '2026-08-18');
  });

  it('dates a first write, when there is no committed date to keep', () => {
    assert.equal(snapshotDate({ committed: undefined, today: '2026-09-25', only: ['a'], failed: 0 }), '2026-09-25');
  });
});

// Raised in review on #172. Every crawler filtered its catalogue by the `--only` ids and never asked
// whether any matched, so `--only=kia-sportgae` selected nothing, read nothing, changed nothing and
// exited 0, and the operator believed the Sportage had been refreshed.
describe('every id --only names is one the crawler can read', () => {
  const failWith = (message) => {
    throw new CrawlerArgumentError(message);
  };

  it('passes ids the crawler has, and no filter at all', () => {
    assert.deepEqual(checkOnlyIds(['kia-sportage'], ['kia-sportage', 'skoda-kodiaq'], { fail: failWith }), ['kia-sportage']);
    assert.equal(checkOnlyIds(null, ['kia-sportage'], { fail: failWith }), null);
  });

  it('stops on a misspelt id, naming it, before anything is read', () => {
    assert.throws(
      () => checkOnlyIds(['kia-sportgae'], ['kia-sportage'], { fail: failWith }),
      /--only names an id this crawler has no record for: kia-sportgae\. Nothing was read/,
    );
  });

  it('names every unknown id when several are given, and the kind of thing it looked for', () => {
    assert.throws(
      () => checkOnlyIds(['kia-sportage', 'a', 'b'], ['kia-sportage'], { what: 'priced trim', fail: failWith }),
      /--only names 2 ids this crawler has no priced trim for: a, b\./,
    );
  });

});

