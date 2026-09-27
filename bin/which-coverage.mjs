#!/usr/bin/env node
// Measures coverage and writes (or, with --check, checks) the badge. In an instance the badge path
// and exclusions come from which.config.mjs; in this package itself they are the defaults.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { coverageMain, DEFAULT_BADGE_PATH, DEFAULT_EXCLUSIONS } from '../node/coverage-badge.mjs';
import { CONFIG_FILE, loadConfig } from '../node/config.mjs';

const config = existsSync(path.join(process.cwd(), CONFIG_FILE)) ? await loadConfig() : null;
coverageMain({
  argv: process.argv.slice(2),
  badgePath: config?.paths.badge ?? DEFAULT_BADGE_PATH,
  exclusions: config?.coverageExclusions ?? DEFAULT_EXCLUSIONS,
});
