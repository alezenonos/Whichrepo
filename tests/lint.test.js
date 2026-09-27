import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { lint, listLintTargets, selectLintTargets } from '../node/lint.mjs';

// #141. `npm run lint` was a hand-maintained chain of `node --check` calls, and a file left off it was
// never syntax-checked: `public/src/cars.js`, which the bundler ships, was missing for months, and the
// sweep test that guarded the list only looked in data/, scripts/ and tests/*.test.js, so a new e2e
// spec would have gone unchecked too. The list is now read from the repository.
describe('the lint target list is the repository, not a list somebody keeps', () => {
  const targets = listLintTargets();

  it('includes the CLIs, the browser modules and the tests without anybody registering them', () => {
    assert.ok(targets.includes('bin/which-lint.mjs'));
    assert.ok(targets.includes('browser/pareto.js'));
    assert.ok(targets.includes('tests/lint.test.js'));
  });

  it('includes every module and test in every directory this package ships', () => {
    const expected = ['bin', 'browser', 'node', 'tests'].flatMap((dir) =>
      fs.readdirSync(dir).filter((name) => /\.m?js$/.test(name)).map((name) => `${dir}/${name}`),
    );
    const missing = expected.filter((file) => !targets.includes(file));
    assert.deepEqual(missing, []);
  });

  it('skips dependencies and build output', () => {
    assert.deepEqual(
      selectLintTargets([
        'node_modules/yaml/index.js',
        'dist/assets/app.0123abcd.js',
        'playwright-report/trace.js',
        'browser/app.js',
        'README.md',
      ]),
      ['browser/app.js'],
    );
  });
});

describe('lint reports a broken file by name', () => {
  it('returns the file and the compiler message, and nothing for a valid file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whichrepo-lint-'));
    fs.writeFileSync(path.join(dir, 'good.mjs'), 'export const ok = 1;\n');
    fs.writeFileSync(path.join(dir, 'bad.mjs'), 'export const = ;\n');
    const failures = await lint(['good.mjs', 'bad.mjs'], { root: dir });
    assert.equal(failures.length, 1);
    assert.equal(failures[0].file, 'bad.mjs');
    assert.match(failures[0].error, /SyntaxError/);
  });
});
