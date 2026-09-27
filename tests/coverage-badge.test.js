// The badge script had no tests, which made the number in the README the one figure in this
// repository nobody checked. Its failure mode is quiet and in the flattering direction: a parser
// that cannot find the summary row, or a threshold that colours 52% green, leaves a badge that
// reads fine and means nothing.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { badgeColour, badgeSvg, parseCoverage } from '../node/coverage-badge.mjs';

// The shape `node --test --experimental-test-coverage` prints, trimmed to the rows the parser
// reads. The leading "# " is part of the TAP output and the parser has to see past it.
const report = [
  '# start of coverage report',
  '# ----------------------------------------',
  '# file         | line % | branch % | funcs % | uncovered lines',
  '# ----------------------------------------',
  '# public       |        |          |         | ',
  '#  src         |        |          |         | ',
  '#   app.js     |  31.69 |    76.37 |   43.70 | 73-74 77-81',
  '#   scoring.js |  94.00 |    78.32 |   94.83 | 121-125',
  '# ----------------------------------------',
  '# all files    |  53.21 |    71.88 |   63.47 | ',
  '# ----------------------------------------',
  '# end of coverage report',
].join('\n');

describe('parseCoverage', () => {
  it('reads the three headline figures off the summary row', () =>
    assert.deepEqual(parseCoverage(report), { line: 53.21, branch: 71.88, functions: 63.47 }));
  // Every per-file row carries a path and only the summary row is labelled "all files". Matching
  // loosely would report whichever file happened to sort first as the project's coverage.
  it('does not mistake a per-file row for the summary', () => {
    const parsed = parseCoverage(report);
    assert.notEqual(parsed.line, 31.69);
    assert.notEqual(parsed.line, 94);
  });
  it('returns nothing when there is no summary row', () =>
    assert.equal(parseCoverage('# some output\n# with no summary'), null));
  // A report that reaches the summary row with unparseable cells is a broken run, and writing a
  // badge from it would publish NaN% as a coverage figure.
  it('returns nothing when the summary cells are not numbers', () =>
    assert.equal(parseCoverage('# all files    | n/a | n/a | n/a | '), null));
  // Blank cells read as zero rather than as "no figure", because `Number('')` is 0. That is safe
  // only because it is caught downstream: a 0.0% badge trips the `--check` drift gate loudly
  // instead of being committed as a plausible number. Pinned so the safety net stays deliberate.
  it('reads blank summary cells as zero, which --check then rejects as drift', () =>
    assert.deepEqual(parseCoverage('# all files    |    |    |    | '), { line: 0, branch: 0, functions: 0 }));
  it('handles an empty report', () => assert.equal(parseCoverage(''), null));
});

describe('badgeColour is deliberately not flattering', () => {
  // A badge whose colour says "good" at 55% trains a reader to ignore it.
  it('reserves green for 90% and above', () => {
    assert.equal(badgeColour(90), '#4c1');
    assert.equal(badgeColour(100), '#4c1');
  });
  it('steps down through the bands', () => {
    assert.equal(badgeColour(89.9), '#97ca00');
    assert.equal(badgeColour(75), '#97ca00');
    assert.equal(badgeColour(74.9), '#dfb317');
    assert.equal(badgeColour(60), '#dfb317');
    assert.equal(badgeColour(59.9), '#fe7d37');
    assert.equal(badgeColour(40), '#fe7d37');
  });
  it('colours anything under 40% as poor, not as adequate', () => {
    assert.equal(badgeColour(39.9), '#e05d44');
    assert.equal(badgeColour(0), '#e05d44');
  });
});

describe('badgeSvg', () => {
  const svg = badgeSvg(53.21);
  it('prints the percentage to one decimal', () => assert.match(svg, />53\.2%</));
  // `--check` reads the figure back out of the committed file with this exact pattern, so the
  // accessible label is load-bearing rather than decorative.
  it('carries a label the check step can parse back', () => {
    assert.match(svg, /aria-label="coverage: 53\.2%"/);
    assert.equal(Number((svg.match(/coverage: ([\d.]+)%/) ?? [])[1]), 53.2);
  });
  it('uses the colour band for the figure it shows', () => {
    assert.match(badgeSvg(53.21), /#fe7d37/);
    assert.match(badgeSvg(95), /#4c1/);
    assert.match(badgeSvg(20), /#e05d44/);
  });
  // The badge is committed and served from the repository so the README renders with no external
  // request. An external reference would reintroduce the dependency it exists to avoid.
  it('is self-contained', () => {
    assert.doesNotMatch(svg, /https?:\/\/(?!www\.w3\.org)/);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });
  it('widens to fit a three-digit figure', () => {
    const wide = Number(/width="(\d+)"/.exec(badgeSvg(100))[1]);
    const narrow = Number(/width="(\d+)"/.exec(badgeSvg(5.2))[1]);
    assert.ok(wide > narrow, `expected 100.0% to be wider than 5.2%, got ${wide} and ${narrow}`);
  });
  it('renders a valid single root element', () => {
    assert.equal((svg.match(/<svg/g) ?? []).length, 1);
    assert.match(svg.trim(), /<\/svg>$/);
  });
});
