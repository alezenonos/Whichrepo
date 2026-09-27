import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { browserModules, vendorBrowserModules, vendorDifferences } from '../node/vendor.mjs';

// The browser side of an instance cannot reach node_modules, so the framework's browser modules are
// copied into it and gated the way its generated catalogue is: `--check` fails when the copy drifts.
describe('vendoring the browser modules', () => {
  const quiet = () => {};
  it('copies every browser module byte for byte, then reports no difference', () => {
    const target = mkdtempSync(path.join(tmpdir(), 'whichrepo-vendor-'));
    vendorBrowserModules({ target, log: quiet });
    for (const name of browserModules()) assert.equal(readFileSync(path.join(target, name), 'utf8'), readFileSync(new URL(`../browser/${name}`, import.meta.url), 'utf8'));
    assert.deepEqual(vendorDifferences({ target }), []);
    assert.deepEqual(vendorBrowserModules({ target, check: true, log: quiet }), []);
  });
  it('names a missing, a changed and a stray file, and fails the check on them', () => {
    const target = mkdtempSync(path.join(tmpdir(), 'whichrepo-vendor-'));
    vendorBrowserModules({ target, log: quiet });
    writeFileSync(path.join(target, 'pareto.js'), '// edited by hand\n');
    writeFileSync(path.join(target, 'stray.js'), '');
    const differences = vendorDifferences({ target });
    assert.ok(differences.includes('pareto.js: differs from the installed package'), differences.join('\n'));
    assert.ok(differences.includes('stray.js: not in the installed package'));
    assert.throws(() => vendorBrowserModules({ target, check: true, log: quiet }), /stale against the installed whichrepo browser modules/);
  });
  it('reports every module missing from an empty target', () => {
    const target = mkdtempSync(path.join(tmpdir(), 'whichrepo-vendor-'));
    assert.deepEqual(vendorDifferences({ target }), browserModules().map((name) => `${name}: missing`));
  });
});
