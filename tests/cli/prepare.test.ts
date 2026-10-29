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

function readChange(workFolder: string) {
  return JSON.parse(fs.readFileSync(path.join(workFolder, 'change.json'), 'utf8'));
}

test('captures a branch against the given base into a work folder outside the checkout', () => {
  const repo = sandbox.repo();
  repo.write({ 'a.txt': 'one\n' });
  repo.commit('start');
  repo.git('checkout', '-q', '-b', 'feat/login');
  repo.write({ 'a.txt': 'one\ntwo\n', 'b.txt': 'new\n' });
  const head = repo.commit('feature');
  repo.git('checkout', '-q', 'trunk');
  repo.write({ 'c.txt': 'only on trunk\n' });
  repo.commit('trunk moves on');

  const result = sandbox.run(['prepare', 'feat/login', '--base', 'trunk'], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  const workFolder = path.join(sandbox.tmp, 'review-tour', 'project-feat-login');
  assert.ok(result.stdout.includes(workFolder), result.stdout);
  const change = readChange(workFolder);
  assert.equal(change.target, 'feat/login');
  assert.equal(change.base, 'trunk');
  assert.equal(change.head, head);
  assert.deepEqual(change.files, [
    { path: 'a.txt', status: 'M', additions: 1, deletions: 0 },
    { path: 'b.txt', status: 'A', additions: 1, deletions: 0 },
  ]);
  const patch = fs.readFileSync(path.join(workFolder, 'change.patch'), 'utf8');
  assert.match(patch, /^\+two$/m);
  assert.doesNotMatch(patch, /only on trunk/);
});

// A local `main` sits halfway along the branch: a tool that assumed `main`
// would show only the second file.
function cloneWithFeatureAndDecoyMain() {
  const { clone } = sandbox.cloned({ 'a.txt': 'one\n' });
  clone.git('checkout', '-q', '-b', 'feature');
  clone.write({ 'x.txt': 'x\n' });
  clone.commit('first');
  clone.git('branch', 'main');
  clone.write({ 'y.txt': 'y\n' });
  clone.commit('second');
  return clone;
}

test("defaults the base to the remote's default branch, never to main", () => {
  const clone = cloneWithFeatureAndDecoyMain();

  const result = sandbox.run(['prepare', 'feature'], { cwd: clone.dir });

  assert.equal(result.status, 0, result.stderr);
  const change = readChange(path.join(sandbox.tmp, 'review-tour', 'project-feature'));
  assert.equal(change.base, 'origin/trunk');
  assert.deepEqual(
    change.files.map((file: { path: string }) => file.path),
    ['x.txt', 'y.txt'],
  );
});

test("asks the remote for its default branch when origin/HEAD is unset", () => {
  const clone = cloneWithFeatureAndDecoyMain();
  clone.git('remote', 'set-head', 'origin', '--delete');

  const result = sandbox.run(['prepare', 'feature'], { cwd: clone.dir });

  assert.equal(result.status, 0, result.stderr);
  const change = readChange(path.join(sandbox.tmp, 'review-tour', 'project-feature'));
  assert.equal(change.base, 'origin/trunk');
  assert.equal(change.files.length, 2);
});

test('fails clearly when no base resolves, even with a main branch at hand', () => {
  const repo = sandbox.repo();
  repo.write({ 'a.txt': 'one\n' });
  repo.commit('start');
  repo.git('branch', 'main');
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write({ 'b.txt': 'two\n' });
  repo.commit('feature');

  const result = sandbox.run(['prepare', 'feature'], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /no base/i);
  assert.match(result.stderr, /--base <ref>/);
  assert.ok(!fs.existsSync(path.join(sandbox.tmp, 'review-tour')));
});

test('rejects an unknown option with the usage, not a stack trace', () => {
  const repo = sandbox.repo();

  const result = sandbox.run(['prepare', 'feature', '--bsae', 'trunk'], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--bsae/);
  assert.match(result.stderr, /usage: review-tour prepare/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});
