// The structural rules a which* repository holds its crawlers to, as findings an instance's test
// asserts are empty. Each rule was learned from a defect in Whichcar (#102-#104, #172), and holding
// them structurally is what stops the next crawler copying the old inline parser: unifying the
// spelling is worth nothing if a copy of either historical shape passes.
//
//   - no crawler calls the global `fetch`: every read goes through fetch-page.mjs (timeout, retries,
//     `Retry-After`, a per-host pool), and a test can drive the whole run through `fetchImpl`
//   - no crawler parses `--only` itself: both historical shapes are named so a copy of either fails
//   - a crawler that reads `--only` also checks the ids against what it can read (`checkOnlyIds`)
//   - `process.exitCode` is set from `exitCodeFor` and nowhere else
//   - the usage comment documents the `--only=` spelling only
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const stripComments = (source) => source.replace(/^\s*\/\/.*$/gm, '');

export function listCrawlers({ root = process.cwd(), dir = 'data', pattern = /^refresh-.*\.mjs$/ } = {}) {
  return readdirSync(path.join(root, dir))
    .filter((name) => pattern.test(name))
    .sort();
}

// `transport` and `args` are the module specifiers the crawlers import the shared rules from, as
// written in their source: an instance that re-exports this package's modules from its own files
// keeps `./fetch-page.mjs` and `./crawler-args.mjs`.
export function crawlerConventionFindings({
  root = process.cwd(),
  dir = 'data',
  pattern = /^refresh-.*\.mjs$/,
  extras = [],
  transport = './fetch-page.mjs',
  args = './crawler-args.mjs',
  minimum = 1,
} = {}) {
  const findings = [];
  const crawlers = listCrawlers({ root, dir, pattern });
  if (crawlers.length < minimum)
    findings.push(`only ${crawlers.length} crawlers found under ${dir}; the pattern is wrong`);
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const importsFrom = (source, specifier) => new RegExp(`from '${escape(specifier)}'`).test(source);
  for (const name of [...crawlers, ...extras]) {
    const source = readFileSync(path.join(root, dir, name), 'utf8');
    const code = stripComments(source);
    if (/(?<![\w.])fetch\(/.test(code)) findings.push(`${name} calls fetch directly instead of ${transport}`);
    if (!importsFrom(source, transport)) findings.push(`${name} does not read through ${transport}`);
  }
  for (const name of crawlers) {
    const source = readFileSync(path.join(root, dir, name), 'utf8');
    const code = stripComments(source);
    if (/startsWith\(['"]--only=/.test(code) || /indexOf\(['"]--only['"]\)/.test(code))
      findings.push(`${name} parses --only itself`);
    if (/--only/.test(code) && !importsFrom(source, args))
      findings.push(`${name} uses --only without the shared reading`);
    const usage = source.match(/^\/\/.*--only.*$/m)?.[0];
    if (usage && /--only <|--only\s+<id/.test(usage))
      findings.push(`${name} still documents the space spelling of --only`);
    if (/readOnly\(/.test(source) && !/checkOnlyIds\(only,/.test(source))
      findings.push(`${name} reads --only and never checks the ids match anything`);
    const assignments = [...code.matchAll(/process\.exitCode\s*=\s*([^;\n]+)/g)].map((match) => match[1]);
    if (!assignments.length) findings.push(`${name} never sets an exit status`);
    for (const value of assignments)
      if (!/^exitCodeFor\(/.test(value))
        findings.push(`${name} sets process.exitCode = ${value} instead of exitCodeFor(...)`);
  }
  return findings;
}
