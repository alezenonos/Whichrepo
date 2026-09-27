import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { crawlerConventionFindings, stripComments } from '../node/conventions.mjs';

// Each rule was learned from a defect, and is held structurally so the next crawler cannot copy the
// old shape: six crawlers had grown their own transport around the global `fetch`, four decided their
// own exit status (one as `process.exitCode = 0`), and two parsed `--only` in ways that silently
// meant "everything".
const GOOD = `// Usage: node data/refresh-x.mjs [--verify] [--only=id,id]
import { readPage } from './fetch-page.mjs';
import { checkOnlyIds, exitCodeFor, readOnly } from './crawler-args.mjs';
export async function run({ argv = process.argv } = {}) {
  const only = readOnly(argv.slice(2));
  checkOnlyIds(only, ['a']);
  return { failed: 0 };
}
if (process.argv[1]?.endsWith('refresh-x.mjs')) {
  const summary = await run();
  process.exitCode = exitCodeFor({ failed: summary.failed });
}
`;
const workspace = (files) => {
  const root = mkdtempSync(path.join(tmpdir(), 'whichrepo-conventions-'));
  mkdirSync(path.join(root, 'data'));
  for (const [name, source] of Object.entries(files)) writeFileSync(path.join(root, 'data', name), source);
  return root;
};

describe('the crawler conventions', () => {
  it('pass a crawler written the way the rules say', () => {
    assert.deepEqual(crawlerConventionFindings({ root: workspace({ 'refresh-x.mjs': GOOD }) }), []);
  });
  it('name a crawler that calls fetch itself, even through a local helper', () => {
    const findings = crawlerConventionFindings({ root: workspace({ 'refresh-x.mjs': GOOD.replace('readPage', 'readPage as _r').replace('export async', 'const get = (u) => fetch(u);\nexport async') }) });
    assert.ok(findings.some((line) => /calls fetch directly/.test(line)), findings.join('\n'));
  });
  it('name a crawler that decides its own exit status or never sets one', () => {
    assert.ok(crawlerConventionFindings({ root: workspace({ 'refresh-x.mjs': GOOD.replace('exitCodeFor({ failed: summary.failed })', '0') }) }).some((line) => /process\.exitCode = 0/.test(line)));
    assert.ok(crawlerConventionFindings({ root: workspace({ 'refresh-x.mjs': GOOD.replace(/process\.exitCode = .*\n/, '') }) }).some((line) => /never sets an exit status/.test(line)));
  });
  it('name a crawler that parses --only itself, or reads it without checking the ids', () => {
    assert.ok(crawlerConventionFindings({ root: workspace({ 'refresh-x.mjs': GOOD.replace("readOnly(argv.slice(2))", "argv.find((a) => a.startsWith('--only='))") }) }).some((line) => /parses --only itself/.test(line)));
    assert.ok(crawlerConventionFindings({ root: workspace({ 'refresh-x.mjs': GOOD.replace("  checkOnlyIds(only, ['a']);\n", '') }) }).some((line) => /never checks the ids/.test(line)));
    assert.ok(crawlerConventionFindings({ root: workspace({ 'refresh-x.mjs': GOOD.replace('[--only=id,id]', '[--only <id>]') }) }).some((line) => /space spelling/.test(line)));
  });
  it('say when the pattern matched fewer crawlers than the instance expects', () => {
    assert.ok(crawlerConventionFindings({ root: workspace({}), minimum: 1 }).some((line) => /only 0 crawlers found/.test(line)));
  });
  it('ignore what a comment says and read what the code does', () => {
    assert.equal(stripComments('// fetch(\nconst a = 1;\n'), '\nconst a = 1;\n');
  });
});
