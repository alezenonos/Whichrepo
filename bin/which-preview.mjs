#!/usr/bin/env node
import path from 'node:path';
import { loadConfig } from '../node/config.mjs';
import { previewMain } from '../node/preview-server.mjs';

const config = await loadConfig();
await previewMain({
  argv: process.argv.slice(2),
  root: path.resolve(config.paths.dist),
  configPath: path.resolve(config.paths.hostConfig),
  defaultPort: config.preview.port,
  originVariable: `${config.envPrefix}_SITE_ORIGIN`,
});
