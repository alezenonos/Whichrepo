#!/usr/bin/env node
import path from 'node:path';
import { loadConfig } from '../node/config.mjs';
import { vendorBrowserModules } from '../node/vendor.mjs';

const config = await loadConfig();
try {
  vendorBrowserModules({
    target: path.resolve(config.paths.vendor),
    check: process.argv.includes('--check'),
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
