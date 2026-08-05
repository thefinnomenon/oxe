#!/usr/bin/env node

import { runCli } from './index.js';

const exitCode = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  io: {
    error: (message) => process.stderr.write(`${message}\n`),
    log: (message) => process.stdout.write(`${message}\n`),
  },
});

process.exitCode = exitCode;
