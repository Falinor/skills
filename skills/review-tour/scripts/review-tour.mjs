#!/usr/bin/env node
// Entry point. Plain JavaScript so that an old Node can still run it and
// print a clear message instead of failing to load TypeScript.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && minor < 12)) {
  console.error(
    `review-tour: needs Node 24.12+ (found ${process.versions.node}).\n` +
      'Install it from https://nodejs.org/ or with a version manager, e.g. `nvm install 24`.',
  );
  process.exit(1);
}

const { main } = await import('./lib/cli.ts');
process.exitCode = await main(process.argv.slice(2));
