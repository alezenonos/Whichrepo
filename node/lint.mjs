// Syntax-check every JavaScript file in the repository.
//
// #141. This used to be a hand-maintained chain of 100-odd `node --check` calls in package.json, and
// CLAUDE.md listed "add new files to it" first among the gotchas. A file left off was not a failure,
// it was silence: `public/src/cars.js`, which the bundler ships, was never checked, and neither was a
// fifth e2e spec whenever somebody wrote one. The list is now whatever the repository contains.
//
// Files come from git (tracked plus untracked-but-not-ignored, so a new file is checked before it is
// committed), with a directory walk as the fallback where there is no git. Either way the same
// directories are skipped: dependencies and build output are not ours to lint.

import { execFileSync, spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.git',
  '.vercel',
  'test-results',
  'playwright-report',
  'coverage',
]);

const isScript = (file) => /\.(?:m?js)$/.test(file);
const isSkipped = (file) => file.split(/[\\/]/).some((part) => SKIPPED_DIRECTORIES.has(part));

export function selectLintTargets(files) {
  return [...new Set(files.filter((file) => isScript(file) && !isSkipped(file)))].sort();
}

function walk(root, dir = '') {
  const found = [];
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) found.push(...walk(root, relative));
    } else {
      found.push(relative);
    }
  }
  return found;
}

export function listLintTargets(root = process.cwd()) {
  let files;
  try {
    files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    files = walk(root);
  }
  return selectLintTargets(files);
}

// `node --check` one file; resolves to null on success or the compiler's message on failure.
function check(file, root) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--check', file], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve(code === 0 ? null : stderr.trim() || `exited ${code}`));
  });
}

export async function lint(files, { root = process.cwd(), concurrency = 8 } = {}) {
  const failures = [];
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const file = files[next++];
      const error = await check(file, root);
      if (error) failures.push({ file, error });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return failures.sort((a, b) => a.file.localeCompare(b.file));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes('--help')) {
    console.log('Usage: which-lint [--list]\n');
    console.log('Runs `node --check` over every .js/.mjs file git knows about (tracked or untracked but');
    console.log(
      `not ignored), skipping ${[...SKIPPED_DIRECTORIES].join(', ')}. --list prints the files only.`,
    );
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
}
