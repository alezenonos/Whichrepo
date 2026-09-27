import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { BundleError, bundleModules, stripModuleSyntax } from '../node/bundle.mjs';

// #138. The bundler deletes module syntax with patterns, and the old patterns rewrote what they did
// not understand into JavaScript that still parsed. `node --check` and the build test catch a syntax
// error; they cannot catch a changed string or a deleted statement. Each case below was demonstrated
// against the old three regexes.
describe('the bundler never alters content it does not own', () => {
  it('leaves the word "export" inside a string alone', () => {
    // The old `.replace(/export /g, '')` turned this into 'CSV ready': valid, wrong, invisible.
    const out = stripModuleSyntax("export const label = 'CSV export ready';\n");
    assert.equal(out, "const label = 'CSV export ready';\n");
  });

  it('leaves a template-literal line that begins with a word like "imported" alone', () => {
    const source = 'export const note = `\nimported duties apply\n`;\n';
    assert.equal(stripModuleSyntax(source), 'const note = `\nimported duties apply\n`;\n');
  });

  it('refuses an import with no semicolon instead of deleting the statement after it', () => {
    // The old lazy pattern ran to the next line ending in `;`, deleting `const KEEP_ME = 1;` with it,
    // and the bundle then threw a ReferenceError in whichever branch first read KEEP_ME.
    assert.throws(
      () => stripModuleSyntax("import { a } from './a.js'\nconst KEEP_ME = 1;\n", 'x.js'),
      (error) => error instanceof BundleError && /x\.js: unsupported module syntax/.test(error.message),
    );
  });

  it('strips an import wrapped over several lines, the shape that once shipped unstripped', () => {
    const source = "import {\n  alpha,\n  beta,\n} from './x.js';\nexport function f() {}\n";
    assert.equal(stripModuleSyntax(source), '\nfunction f() {}\n');
  });

  it('strips a re-export, as cars.js does', () => {
    assert.equal(stripModuleSyntax("export { cars, catalogueVersion } from './cars.generated.js';\n"), '\n');
  });
});

describe('the bundler refuses what concatenation cannot provide, by file and line', () => {
  const cases = [
    ['export default function boot() {}', /export default/],
    ["import { a as b } from './a.js';", /renamed binding/],
    ['export { a as b };', /renamed binding/],
    ["import x from './a.js';", /default import/],
    ["import * as ns from './a.js';", /namespace import/],
    ["export * from './a.js';", /export \*/],
    ["const m = await import('./a.js');", /dynamic `import\(\)`/],
    ['const here = import.meta.url;', /import\.meta/],
  ];
  for (const [line, reason] of cases) {
    it(`refuses ${line}`, () => {
      assert.throws(
        () => stripModuleSyntax(`const first = 1;\n${line}\n`, 'mod.js'),
        (error) => error instanceof BundleError && error.message.startsWith('mod.js:2: ') && reason.test(error.message),
      );
    });
  }
});

describe('the browser modules this package ships bundle', () => {
  // The order an instance concatenates them in: a module before everything that imports it.
  const order = ['contrast.js', 'bands.js', 'pareto.js', 'weights.js', 'scales.js', 'colour.js'];

  it('lists every browser module, so a new one cannot ship untested by the bundler', () => {
    assert.deepEqual([...order].sort(), fs.readdirSync('browser').filter((name) => name.endsWith('.js')).sort());
  });

  it('bundles without a refusal, leaves no module syntax behind, and parses as one script', () => {
    const bundled = bundleModules(order.map((name) => ({ name, source: fs.readFileSync(`browser/${name}`, 'utf8') })));
    assert.doesNotMatch(bundled, /^[ \t]*(import|export)\b/m);
    // Concatenation gives every top-level binding one scope, so two modules declaring the same
    // name would be a SyntaxError in the browser and nowhere else. Parsed here instead.
    assert.doesNotThrow(() => new Function(bundled));
  });
});
