import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

test('needs gh for a pull request, not for a branch', () => {
  // A PATH holding git alone: gh often lives next to git (/usr/bin), so link the real binary.
  const gitBinary = path.join(spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim(), 'git');
  fs.symlinkSync(gitBinary, path.join(sandbox.bin, 'git'));
  const repo = sandbox.repo();
  repo.write({ 'a.txt': 'one\n' });
  repo.commit('start');
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write({ 'b.txt': 'two\n' });
  repo.commit('feature');
  const env = { PATH: sandbox.bin };

  const pullRequest = sandbox.run(['prepare', '7'], { cwd: repo.dir, env });
  const branch = sandbox.run(['prepare', 'feature', '--base', 'trunk'], { cwd: repo.dir, env });

  assert.equal(pullRequest.status, 1);
  assert.match(pullRequest.stderr, /needs gh/);
  assert.match(pullRequest.stderr, /cli\.github\.com/);
  assert.equal(branch.status, 0, branch.stderr);
});
