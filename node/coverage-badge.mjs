// Measures test coverage and writes the badge the README displays.
//
// Usage: which-coverage [--check], or from an instance's own script through `coverageMain`.
//
// The exclusions are the whole point of this script, and each one is there because including it
// made the headline number a lie:
//
//   tests/**            a test file is executed by definition, so counting it reports 100% for the
//                       act of running the suite and tells a reader nothing about the code.
//   cars.generated.js   ~20,000 lines of generated catalogue data, loaded whole by almost every
//                       test. It alone lifted the reported figure from 52% to 91%.
//   dist/**             build output, a copy of source already counted once.
//
// Uncorrected the badge would read around 91% regardless of what the suite actually checks. The
// figure it does print is the one a reader can act on, which is the whole point of the exclusions.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_BADGE_PATH = 'docs/coverage.svg';
// `tests/**` and `dist/**` for the reasons above; an instance adds its generated catalogue module and
// its vendored copy of this package's browser modules, which are tested here rather than there.
export const DEFAULT_EXCLUSIONS = ['tests/**', 'dist/**'];
// Wide enough to absorb ordinary drift, tight enough that a real drop in coverage still fails.
export const BADGE_TOLERANCE = 1;

export function parseCoverage(report) {
  // The summary row is the only one whose label is "all files"; per-file rows carry a path.
  const row = report.split('\n').find((line) => /^#\s*all files/.test(line));
  if (!row) return null;
  const [line, branch, functions] = row
    .split('|')
    .slice(1, 4)
    .map((cell) => Number(cell.trim()));
  return Number.isFinite(line) && Number.isFinite(branch) && Number.isFinite(functions)
    ? { line, branch, functions }
    : null;
}

// Thresholds are deliberately not flattering. A badge whose colour says "good" at 55% trains a
// reader to ignore it.
export function badgeColour(percent) {
  if (percent >= 90) return '#4c1';
  if (percent >= 75) return '#97ca00';
  if (percent >= 60) return '#dfb317';
  if (percent >= 40) return '#fe7d37';
  return '#e05d44';
}

export function badgeSvg(percent) {
  const label = 'coverage';
  const value = `${percent.toFixed(1)}%`;
  // Widths approximate the 11px Verdana the shields.io convention uses. Self-contained: the badge
  // is committed and served from the repository, so the README renders with no external request.
  const labelWidth = 62;
  const valueWidth = 8 + value.length * 8;
  const total = labelWidth + valueWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${badgeColour(percent)}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
  </g>
</svg>
`;
}

export function measure(exclusions = DEFAULT_EXCLUSIONS) {
  const args = [
    '--test',
    '--experimental-test-coverage',
    ...exclusions.map((glob) => `--test-coverage-exclude=${glob}`),
  ];
  let output = '';
  try {
    output = execFileSync(process.execPath, args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    // Two different failures reach this branch and they need different messages. A red suite still
    // prints a coverage report; a runner that could not start prints none. Reporting both as "the
    // test suite failed" sent CI chasing a phantom test failure when the real cause was Node 20
    // not having --test-coverage-exclude, which arrived in 22.5 -- the suite had passed.
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    process.stderr.write(output);
    if (output.includes('start of coverage report')) {
      throw new Error('The test suite failed; refusing to write a coverage badge from a red run.');
    }
    throw new Error(
      `Could not run coverage (node ${process.versions.node}). The suite itself may be fine: ` +
        'this needs Node 22.5+ for --test-coverage-exclude. See the output above.',
    );
  }
  const coverage = parseCoverage(output);
  if (!coverage) throw new Error('Could not read a coverage summary from the test output.');
  return coverage;
}

export function coverageMain({
  argv = process.argv.slice(2),
  badgePath = DEFAULT_BADGE_PATH,
  exclusions = DEFAULT_EXCLUSIONS,
} = {}) {
  const check = argv.includes('--check');
  const coverage = measure(exclusions);
  const svg = badgeSvg(coverage.line);
  if (check) {
    // Compared as a number with a tolerance, never as bytes. Coverage moves a tenth of a point for
    // reasons that are not a stale badge -- deleting dead code shifted it 52.23 to 52.12 -- and a
    // byte-exact gate would fail CI on the rounding rather than on anything a reader would notice.
    // A gate that cries wolf gets disabled, which is worse than not having one.
    const current = fs.existsSync(badgePath) ? fs.readFileSync(badgePath, 'utf8') : '';
    const shown = Number((current.match(/coverage: ([\d.]+)%/) ?? [])[1]);
    if (!Number.isFinite(shown)) {
      console.error(`${badgePath} is missing or unreadable. Run \`npm run coverage\` and commit the result.`);
      process.exit(1);
    }
    const drift = Math.abs(shown - coverage.line);
    if (drift > BADGE_TOLERANCE) {
      console.error(
        `${badgePath} shows ${shown.toFixed(1)}% but the suite measures ${coverage.line.toFixed(2)}% ` +
          `(drift ${drift.toFixed(2)} > ${BADGE_TOLERANCE}). Run \`npm run coverage\` and commit the result.`,
      );
      process.exit(1);
    }
    console.log(
      `${badgePath} is current: shows ${shown.toFixed(1)}%, measured ${coverage.line.toFixed(2)}%.`,
    );
    return;
  }
  fs.mkdirSync(path.dirname(badgePath), { recursive: true });
  fs.writeFileSync(badgePath, svg);
  console.log(
    `line ${coverage.line.toFixed(2)}%  branch ${coverage.branch.toFixed(2)}%  functions ${coverage.functions.toFixed(2)}%`,
  );
  console.log(`Wrote ${badgePath}.`);
}
