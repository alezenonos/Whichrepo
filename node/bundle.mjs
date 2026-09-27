// The bundler's one transformation: turn a set of ES modules into one classic-script-compatible
// concatenation by deleting their module syntax.
//
// #138. This used to be three regexes inside build.mjs, and the third was `.replace(/export /g, '')`:
// global and unanchored, so `'CSV export ready'` became `'CSV ready'` -- valid JavaScript with a
// changed string, which no test could see. The import pattern ran lazily to the next line ending in
// `;`, so an import written without a semicolon deleted the statement after it, and the browser found
// out as a ReferenceError in whichever branch reached it. The rewrite now handles exactly the shapes
// the sources use, anchored to the start of a line, and refuses everything else by file and line.
// Unsupported input fails the build; it is never rewritten into something that looks fine.
//
// What is supported, because concatenation provides the binding it names:
//   import { a, b } from './x.js';            (possibly wrapped over several lines)
//   export const|let|var|function|async function|class ...
//   export { a, b } from './x.js';            (a re-export, as cars.js does)
//   export { a, b };
// What is refused: renames (`as`), default and namespace imports or exports, `export *`, dynamic
// `import()` and `import.meta` -- each of which would need a binding concatenation cannot provide.

const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*(['"])[^'"\n]+\2[ \t]*;[ \t]*$/gm;
const EXPORT_LIST = /^export\s*\{([^}]*)\}\s*(?:from\s*(['"])[^'"\n]+\2)?[ \t]*;[ \t]*$/gm;
const EXPORT_DECLARATION = /^export (?=(?:async function|function|class|const|let|var)\b)/gm;

const REFUSALS = [
  [/^export\s+default\b/m, '`export default` has no name for the concatenated bundle to bind'],
  [/^export\s*\*/m, '`export *` cannot be resolved by concatenation'],
  [/^import\s+\*/m, 'a namespace import cannot be resolved by concatenation'],
  [/^import\s+[\w$]+\s*(?:,|from\b)/m, 'a default import has no binding in the concatenated bundle'],
  [/^import\s*['"]/m, 'a side-effect import is not bundled; add the file to moduleFiles instead'],
  [/\bimport\s*\(/m, 'dynamic `import()` is not bundled'],
  [/\bimport\.meta\b/m, '`import.meta` does not exist in the bundle'],
];

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

export class BundleError extends Error {}

function refuse(fileName, source, index, reason) {
  throw new BundleError(`${fileName}:${lineOf(source, index)}: ${reason}`);
}

function refuseRenames(fileName, source, pattern) {
  for (const match of source.matchAll(pattern)) {
    if (/\bas\b/.test(match[1])) {
      refuse(fileName, source, match.index, 'a renamed binding (`as`) would be undefined in the bundle');
    }
  }
}

export function stripModuleSyntax(source, fileName = '<source>') {
  for (const [pattern, reason] of REFUSALS) {
    const match = pattern.exec(source);
    if (match) refuse(fileName, source, match.index, reason);
  }
  refuseRenames(fileName, source, IMPORT);
  refuseRenames(fileName, source, EXPORT_LIST);

  const stripped = source.replace(IMPORT, '').replace(EXPORT_LIST, '').replace(EXPORT_DECLARATION, '');

  // Anything that still starts a line with `import` or `export` is a shape the patterns above did
  // not understand -- an import with no semicolon, an export of a new declaration kind. Refused
  // rather than shipped: the browser would reject the whole bundle for it.
  const leftover = /^[ \t]*(import|export)\b/m.exec(stripped);
  if (leftover) {
    const line = stripped.slice(leftover.index).split('\n', 1)[0].trim();
    throw new BundleError(
      `${fileName}: unsupported module syntax survived the rewrite: ${JSON.stringify(line.slice(0, 80))}`,
    );
  }
  return stripped;
}

export function bundleModules(entries) {
  return entries.map(({ name, source }) => `// ${name}\n${stripModuleSyntax(source, name)}`).join('\n');
}
