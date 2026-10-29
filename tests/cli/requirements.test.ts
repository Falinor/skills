import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.cleanup());

test('stops with an install hint when Node is older than 24.12', () => {
  const preload = path.join(sandbox.root, 'old-node.mjs');
  fs.writeFileSync(preload, 'Object.defineProperty(process.versions, "node", { value: "24.11.1" });\n');
  const repo = sandbox.repo();

  const result = sandbox.run(['prepare', 'trunk'], { cwd: repo.dir, nodeArgs: ['--import', preload] });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Node 24\.12\+/);
  assert.match(result.stderr, /found 24\.11\.1/);
  assert.match(result.stderr, /nodejs\.org/);
});

test('stops with an install hint when git is missing', () => {
  const repo = sandbox.repo();

  const result = sandbox.run(['prepare', 'trunk'], { cwd: repo.dir, env: { PATH: sandbox.bin } });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /needs git/);
  assert.match(result.stderr, /git-scm\.com/);
});
