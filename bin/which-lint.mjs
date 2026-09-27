#!/usr/bin/env node
import { lint, listLintTargets, SKIPPED_DIRECTORIES } from '../node/lint.mjs';

if (process.argv.includes('--help')) {
  console.log('Usage: which-lint [--list]\n');
  console.log('Runs `node --check` over every .js/.mjs file git knows about (tracked or untracked but');
  console.log(`not ignored), skipping ${[...SKIPPED_DIRECTORIES].join(', ')}. --list prints the files only.`);
  process.exit(0);
}
const files = listLintTargets();
if (process.argv.includes('--list')) {
  console.log(files.join('\n'));
  process.exit(0);
}
const failures = await lint(files);
for (const { file, error } of failures) console.error(`${file}\n${error}\n`);
if (failures.length) {
  console.error(`${failures.length} of ${files.length} files failed the syntax check.`);
  process.exit(1);
}
console.log(`Syntax-checked ${files.length} files.`);
