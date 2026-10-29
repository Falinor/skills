import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fakeGh, pullRequestRepo } from '../support/github.ts';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';
import { workFolder, writePlan } from '../support/tour.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.cleanup());

const folderOf = (target: string, since: string) => workFolder(sandbox, `${target}-since-${since}`);

function readCapture(folder: string) {
  return {
    change: JSON.parse(fs.readFileSync(path.join(folder, 'change.json'), 'utf8')),
    patch: fs.readFileSync(path.join(folder, 'change.patch'), 'utf8'),
  };
}

const paths = (change: { files: { path: string }[] }) => change.files.map((file) => file.path);

/** A `feature` branch toured once at `earlier`, then given more commits. */
function branchToured() {
  const repo = sandbox.repo();
  repo.write({ 'a.txt': 'one\n' });
  repo.commit('start');
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write({ 'b.txt': 'first\n', 'old.txt': 'reviewed already\n' });
  const earlier = repo.commit('first round').slice(0, 12);
  return { repo, earlier };
}

test('since <sha> limits a branch tour to the commits after that head', () => {
  const { repo, earlier } = branchToured();
  repo.write({ 'b.txt': 'first\nsecond\n', 'c.txt': 'new\n' });
  const head = repo.commit('address feedback');

  const result = sandbox.run(['prepare', 'feature', '--base', 'trunk', '--since', earlier], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  const folder = folderOf('feature', earlier);
  assert.ok(result.stdout.includes(folder), result.stdout);
  assert.match(result.stdout, new RegExp(`only what changed since ${earlier}`));
  const { change, patch } = readCapture(folder);
  assert.equal(change.head, head);
  assert.deepEqual(paths(change), ['b.txt', 'c.txt']);
  assert.deepEqual(change.files[0], { path: 'b.txt', status: 'M', additions: 1, deletions: 0 });
  assert.match(patch, /^\+second$/m);
  assert.doesNotMatch(patch, /^\+first$/m);
  assert.doesNotMatch(patch, /reviewed already/);
});

/** Pull request #7, toured once at `earlier` (the clone fetched it then), then given more commits. */
function pullRequestToured() {
  const world = pullRequestRepo(sandbox, { 'a.txt': 'one\n' });
  world.author.write({ 'f.txt': 'first\n' });
  world.author.commit('first round');
  const view = world.publish();
  fakeGh(sandbox, [{ args: ['pr', 'view'], stdout: view }]);
  const result = sandbox.run(['prepare', '7'], { cwd: world.clone.dir });
  assert.equal(result.status, 0, result.stderr);
  return { ...world, earlier: view.headRefOid.slice(0, 12) };
}

test('since <sha> limits a pull request tour to the commits after that head', () => {
  const { clone, author, publish, earlier } = pullRequestToured();
  author.write({ 'g.txt': 'second\n' });
  author.commit('address feedback');
  const view = publish();
  fakeGh(sandbox, [{ args: ['pr', 'view'], stdout: view }]);

  const result = sandbox.run(['prepare', '7', '--since', earlier], { cwd: clone.dir });

  assert.equal(result.status, 0, result.stderr);
  const { change } = readCapture(folderOf('PR-7', earlier));
  assert.equal(change.target, 'PR #7');
  assert.equal(change.head, view.headRefOid);
  assert.deepEqual(paths(change), ['g.txt']);
  // The earlier tour stays as it was.
  assert.deepEqual(paths(readCapture(workFolder(sandbox, 'PR-7')).change), ['f.txt']);
});

test('covers the full change and says why when the earlier head was rewritten by a force-push', () => {
  const { repo, earlier } = branchToured();
  repo.write({ 'b.txt': 'first, amended\n' });
  repo.git('commit', '-q', '-a', '--amend', '-m', 'first round, amended');

  const result = sandbox.run(['prepare', 'feature', '--base', 'trunk', '--since', earlier], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /covers the full change/);
  assert.match(result.stdout, new RegExp(`${earlier} is no longer in the history of feature`));
  const { change } = readCapture(folderOf('feature', earlier));
  assert.deepEqual(paths(change), ['b.txt', 'old.txt']);
  assert.equal(change.followUp.since, earlier);
  assert.match(change.followUp.fallback, /no longer in the history/);
  assert.equal(change.followUp.from, undefined);
});

test('covers the full change and says why when the earlier head of a force-pushed pull request is unknown', () => {
  const { clone, author, publish } = pullRequestToured();
  const vanished = 'deadbeef0123';
  author.write({ 'g.txt': 'second\n' });
  author.commit('address feedback');
  const view = publish();
  fakeGh(sandbox, [{ args: ['pr', 'view'], stdout: view }]);

  const result = sandbox.run(['prepare', '7', '--since', vanished], { cwd: clone.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /covers the full change/);
  assert.match(result.stdout, new RegExp(`${vanished} names no commit here`));
  const { change } = readCapture(folderOf('PR-7', vanished));
  assert.deepEqual(paths(change), ['f.txt', 'g.txt']);
  assert.match(change.followUp.fallback, /force-push/);
});

test("leaves out the base's changes when the author merged the base in since the earlier head", () => {
  const { repo, earlier } = branchToured();
  repo.git('checkout', '-q', 'trunk');
  repo.write({ 'a.txt': 'one\nupstream\n', 't.txt': 'from trunk\n' });
  repo.commit('trunk moves on');
  repo.git('checkout', '-q', 'feature');
  repo.git('merge', '-q', '--no-edit', 'trunk');
  repo.write({ 'b.txt': 'first\nsecond\n' });
  repo.commit('address feedback');

  const result = sandbox.run(['prepare', 'feature', '--base', 'trunk', '--since', earlier], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`only what changed since ${earlier}`));
  assert.match(result.stdout, /base was merged in/);
  const { change, patch } = readCapture(folderOf('feature', earlier));
  assert.equal(change.mergeBase, repo.git('rev-parse', 'trunk'));
  assert.deepEqual(paths(change), ['b.txt']);
  assert.match(patch, /^\+second$/m);
  assert.doesNotMatch(patch, /upstream|from trunk/);
});

test('covers the full change and says why when replaying the earlier head onto the merged-in base conflicts', () => {
  const repo = sandbox.repo();
  repo.write({ 'a.txt': 'one\n' });
  repo.commit('start');
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write({ 'a.txt': 'one, by the author\n' });
  const earlier = repo.commit('first round').slice(0, 12);
  repo.git('checkout', '-q', 'trunk');
  repo.write({ 'a.txt': 'one, upstream\n' });
  repo.commit('trunk edits the same line');
  repo.git('checkout', '-q', 'feature');
  assert.throws(() => repo.git('merge', '-q', '--no-edit', 'trunk'));
  repo.write({ 'a.txt': 'one, by the author and upstream\n' });
  repo.commit('merge trunk');
  repo.write({ 'b.txt': 'second\n' });
  repo.commit('address feedback');

  const result = sandbox.run(['prepare', 'feature', '--base', 'trunk', '--since', earlier], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /covers the full change, because the base was merged in since .* conflicts/);
  const { change } = readCapture(folderOf('feature', earlier));
  assert.deepEqual(paths(change), ['a.txt', 'b.txt']);
  assert.equal(change.followUp.from, undefined);
});

/** The page's visible text. */
const pageText = (folder: string) =>
  fs.readFileSync(path.join(folder, 'tour.html'), 'utf8').replace(/<[^>]*>/g, '').replace(/&#39;/g, "'");

test('validates the plan against the narrowed range and says on the page what the tour covers', () => {
  const { repo, earlier } = branchToured();
  repo.write({ 'b.txt': 'first\nsecond\n' });
  repo.commit('address feedback');
  sandbox.run(['prepare', 'feature', '--base', 'trunk', '--since', earlier], { cwd: repo.dir });
  const folder = folderOf('feature', earlier);

  writePlan(folder, { steps: [{ title: 'Both rounds', files: ['b.txt', 'old.txt'], explanation: 'x' }] });
  const rejected = sandbox.run(['render', folder], { cwd: repo.dir });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /old\.txt is not part of the change/);

  writePlan(folder, { steps: [{ title: 'Second round', files: ['b.txt'], explanation: 'x' }] });
  const rendered = sandbox.run(['render', folder], { cwd: repo.dir });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(pageText(folder), new RegExp(`Follow-up: only what changed since ${earlier}\\.`));
});

test('says on the page why a follow-up covers the full change', () => {
  const { repo, earlier } = branchToured();
  repo.git('commit', '-q', '--amend', '-m', 'first round, reworded');
  sandbox.run(['prepare', 'feature', '--base', 'trunk', '--since', earlier], { cwd: repo.dir });
  const folder = folderOf('feature', earlier);
  writePlan(folder, { steps: [{ title: 'Everything', files: ['b.txt', 'old.txt'], explanation: 'x' }] });

  const rendered = sandbox.run(['render', folder], { cwd: repo.dir });

  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(pageText(folder), /Follow-up: covers the full change, because .* is no longer in the history of feature/);
});
