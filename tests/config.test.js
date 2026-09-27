import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadConfig, normaliseConfig } from '../node/config.mjs';

describe('which.config.mjs', () => {
  it('derives the slug, the prefix and the coverage exclusions from the name and paths', () => {
    const config = normaliseConfig({ name: 'WhichPhone' });
    assert.equal(config.slug, 'whichphone');
    assert.equal(config.envPrefix, 'WHICHPHONE');
    assert.equal(config.paths.vendor, 'public/src/whichrepo');
    assert.deepEqual(config.coverageExclusions, ['tests/**', 'dist/**', 'public/src/whichrepo/**']);
    assert.equal(config.preview.port, 4174);
  });
  it('keeps what the instance states', () => {
    const config = normaliseConfig({ name: 'WhichCar', envPrefix: 'WC', paths: { vendor: 'public/vendor' }, coverageExclusions: ['x/**'] });
    assert.equal(config.envPrefix, 'WC');
    assert.equal(config.paths.vendor, 'public/vendor');
    assert.equal(config.paths.dist, 'dist');
    assert.deepEqual(config.coverageExclusions, ['x/**']);
  });
  it('refuses a config with no name', () => assert.throws(() => normaliseConfig({}), /must export a `name`/));
  it('loads the file from a root and fails plainly when there is none', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'whichrepo-config-'));
    await assert.rejects(loadConfig(root), /No which\.config\.mjs/);
    writeFileSync(path.join(root, 'which.config.mjs'), "export default { name: 'WhichBike' };\n");
    assert.equal((await loadConfig(root)).envPrefix, 'WHICHBIKE');
  });
});
