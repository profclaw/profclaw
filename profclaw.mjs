#!/usr/bin/env node

import module from "node:module";

// Enable V8 compile cache for faster startup
// https://nodejs.org/api/module.html#module-compile-cache
if (module.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try {
    module.enableCompileCache();
  } catch {
    // Ignore errors
  }
}

// Suppress noisy logs for quick CLI queries (--version, --help, completion)
if (!process.env.LOG_LEVEL) {
  const quietArgs = ['--version', '-v', '--help', '-h', 'completion'];
  const isQuiet = process.argv.length <= 2 || process.argv.some(a => quietArgs.includes(a));
  if (isQuiet) {
    process.env.LOG_LEVEL = 'WARN';
  }
}

await import("./dist/cli/index.js");
