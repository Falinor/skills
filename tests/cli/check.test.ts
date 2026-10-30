import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { fakeDifft } from '../support/difftastic.ts';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.cleanup());

test('without difftastic, asks once whether to install it and installs nothing', () => {
  const installers = ['brew', 'cargo', 'curl'].map((name) => sandbox.fake(name));
  const repo = sandbox.repo();

  const result = sandbox.run(['check', 'feature'], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Ready: git found\./);
  assert.equal(result.stdout.split('\n').filter((line) => /difftastic/i.test(line)).length, 1, result.stdout);
  assert.match(result.stdout, /brew install difftastic/);
  assert.match(result.stdout, /cargo install --locked difftastic/);
  for (const installer of installers) assert.deepEqual(installer.log(), []);
});

test('with difftastic, is ready without a question', () => {
  fakeDifft(sandbox);
  const repo = sandbox.repo();

  const result = sandbox.run(['check', 'feature'], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Ready: git and difftastic found.\n');
});

test('for a pull request, needs gh and fetches nothing', () => {
  const gh = sandbox.fake('gh');
  const repo = sandbox.repo();

  const result = sandbox.run(['check', '7'], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Ready: git and gh found\./);
  assert.deepEqual(gh.log(), [['--version']]);
});

test('takes exactly one target', () => {
  const repo = sandbox.repo();

  const result = sandbox.run(['check'], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage: review-tour check/);
});
