#!/usr/bin/env node

import { runCli } from "./lib/cli.js";

void runCli(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
