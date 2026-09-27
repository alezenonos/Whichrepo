// Copies this package's browser modules into an instance's source tree, and checks the copy.
//
// The browser side of a which* site loads native ES modules from `public/` with no bundler in
// development, and its production build concatenates a fixed list of files. Neither can reach
// `node_modules`, so the framework's browser modules are vendored: copied into the instance,
// committed there like any generated file, and gated by `--check` so CI fails when the copy has
// drifted from the installed package -- the same rule the instance already applies to its
// generated catalogue module.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BROWSER_DIR = fileURLToPath(new URL('../browser/', import.meta.url));

export function browserModules(source = BROWSER_DIR) {
  return readdirSync(source)
    .filter((name) => name.endsWith('.js'))
    .sort();
}

// Returns the names that differ (or are missing) between the package and the target directory.
export function vendorDifferences({ source = BROWSER_DIR, target }) {
  const differences = [];
  for (const name of browserModules(source)) {
    const wanted = readFileSync(path.join(source, name), 'utf8');
    const file = path.join(target, name);
    if (!existsSync(file)) differences.push(`${name}: missing`);
    else if (readFileSync(file, 'utf8') !== wanted)
      differences.push(`${name}: differs from the installed package`);
  }
  for (const name of existsSync(target) ? readdirSync(target) : []) {
    if (name.endsWith('.js') && !existsSync(path.join(source, name)))
      differences.push(`${name}: not in the installed package`);
  }
  return differences;
}

export function vendorBrowserModules({ source = BROWSER_DIR, target, check = false, log = console.log }) {
  if (!target) throw new Error('vendorBrowserModules needs a target directory');
  const differences = vendorDifferences({ source, target });
  if (check) {
    if (differences.length) {
      for (const line of differences) log(line);
      throw new Error(
        `${target} is stale against the installed whichrepo browser modules (${differences.length} difference${differences.length === 1 ? '' : 's'}). Run \`which-vendor\` and commit the result.`,
      );
    }
    log(`${target} matches the installed whichrepo browser modules.`);
    return [];
  }
  mkdirSync(target, { recursive: true });
  for (const name of browserModules(source))
    writeFileSync(path.join(target, name), readFileSync(path.join(source, name)));
  log(`Vendored ${browserModules(source).length} browser modules into ${target}.`);
  return differences;
}
