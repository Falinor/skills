import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fakeGh, pullRequestRepo, pullRequestUrl } from '../support/github.ts';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.cleanup());

const workFolder = () => path.join(sandbox.tmp, 'review-tour', 'project-PR-7');

function readWorkFile(name: string) {
  return JSON.parse(fs.readFileSync(path.join(workFolder(), name), 'utf8'));
}

/**
 * Pull request #7 targets `release`, a branch the clone has never seen, cut
 * from trunk with r.txt; the pull request adds f.txt on top of it.
 */
function pullRequestOnRelease() {
  const world = pullRequestRepo(sandbox, { 'a.txt': 'one\n' });
  world.author.write({ 'r.txt': 'release\n' });
  world.author.commit('release');
  world.push('release');
  world.author.write({ 'f.txt': 'feature\n' });
  world.author.commit('feature');
  return { ...world, view: world.publish('release') };
}

test("tours a pull request by number: fetches its refs through gh, uses its base and records its head", () => {
  const { clone, view } = pullRequestOnRelease();
  const gh = fakeGh(sandbox, [{ args: ['pr', 'view'], stdout: view }]);

  const result = sandbox.run(['prepare', '7'], { cwd: clone.dir });

  assert.equal(result.status, 0, result.stderr);
  const call = gh.log().find((args) => args[0] === 'pr');
  assert.deepEqual(call?.slice(0, 4), ['pr', 'view', '7', '--json']);
  const change = readWorkFile('change.json');
  assert.equal(change.target, 'PR #7');
  assert.equal(change.base, 'release');
  assert.equal(change.mergeBase, view.baseRefOid);
  assert.equal(change.head, view.headRefOid);
  assert.deepEqual(change.pullRequest, { number: 7, url: pullRequestUrl });
  assert.deepEqual(
    change.files.map((file: { path: string }) => file.path),
    ['f.txt'],
  );
  // Nothing checked out: the clone keeps its branch, its files and no new branch.
  assert.equal(clone.git('branch', '--format=%(refname:short)'), 'trunk');
  assert.equal(clone.git('status', '--porcelain'), '');
});

test('tours a pull request by URL, fetching from its repository when no remote points there', () => {
  const { clone, origin, view } = pullRequestOnRelease();
  clone.git('remote', 'set-url', 'origin', path.join(sandbox.root, 'fork.git'));
  clone.git('config', '--global', `url.${origin.dir}.insteadOf`, 'https://github.com/acme/project.git');
  const gh = fakeGh(sandbox, [{ args: ['pr', 'view'], stdout: view }]);

  const result = sandbox.run(['prepare', `${pullRequestUrl}/files`], { cwd: clone.dir });

  assert.equal(result.status, 0, result.stderr);
  const call = gh.log().find((args) => args[0] === 'pr');
  assert.deepEqual(call?.slice(0, 3), ['pr', 'view', pullRequestUrl]);
  const change = readWorkFile('change.json');
  assert.equal(change.head, view.headRefOid);
  assert.deepEqual(
    change.files.map((file: { path: string }) => file.path),
    ['f.txt'],
  );
});

test("a given base replaces the pull request's base", () => {
  const { clone, view } = pullRequestOnRelease();
  fakeGh(sandbox, [{ args: ['pr', 'view'], stdout: view }]);

  const result = sandbox.run(['prepare', '7', '--base', 'origin/trunk'], { cwd: clone.dir });

  assert.equal(result.status, 0, result.stderr);
  const change = readWorkFile('change.json');
  assert.equal(change.base, 'origin/trunk');
  assert.equal(change.mergeBase, clone.git('rev-parse', 'origin/trunk'));
  assert.deepEqual(
    change.files.map((file: { path: string }) => file.path),
    ['f.txt', 'r.txt'],
  );
});

test("relays gh's message when it can't find the pull request", () => {
  const { clone } = pullRequestOnRelease();
  fakeGh(sandbox, [
    { args: ['pr', 'view'], status: 1, stderr: 'GraphQL: Could not resolve to a PullRequest with the number of 7.\n' },
  ]);

  const result = sandbox.run(['prepare', '7'], { cwd: clone.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not resolve to a PullRequest/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
  assert.ok(!fs.existsSync(workFolder()));
});

test('refuses a pull request whose head moved while it was fetched', () => {
  const { clone, view } = pullRequestOnRelease();
  fakeGh(sandbox, [{ args: ['pr', 'view'], stdout: { ...view, headRefOid: '1'.repeat(40) } }]);

  const result = sandbox.run(['prepare', '7'], { cwd: clone.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /moved while it was fetched; run prepare again/);
  assert.ok(!fs.existsSync(workFolder()));
});
