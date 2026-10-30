import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fakeDifft, realDifftDir } from '../support/difftastic.ts';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';
import { filesOf, prepareChange } from '../support/tour.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.cleanup());

// A formatter reflow: lines joined and split, spaces inside lines changed.
const compact = "export const point = { x: 1, y: 2 };\nexport function area(a: number,b: number) { return a*b; }\n";
const reflowed = 'export const point = {\n  x: 1,\n  y: 2\n};\nexport function area(a: number, b: number) {\n  return a * b;\n}\n';

test('with difftastic, proves a formatter reflow syntax-identical', () => {
  const difft = fakeDifft(sandbox);
  const { folder } = prepareChange(sandbox, {
    trunk: { 'src/shape.ts': compact, 'src/other.ts': compact },
    feature: { 'src/shape.ts': reflowed, 'src/other.ts': reflowed.replace('a * b', 'a + b') },
  });

  const files = filesOf(folder);
  assert.deepEqual(files.get('src/shape.ts')?.proofs, ['syntax-identical']);
  assert.equal(files.get('src/other.ts')?.proofs, undefined);
  const checks = difft.log().filter((args) => args[0] !== '--version');
  assert.equal(checks.length, 2);
  for (const args of checks) assert.deepEqual(args.slice(0, 2), ['--check-only', '--exit-code']);
});

test('without difftastic, carries on, says once how to install it and installs nothing', () => {
  const installers = ['brew', 'cargo', 'curl'].map((name) => sandbox.fake(name));
  const { repo, folder } = prepareChange(sandbox, {
    trunk: { 'src/shape.ts': compact },
    feature: { 'src/shape.ts': reflowed },
  });

  const result = sandbox.run(['prepare', 'feature', '--base', 'trunk'], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(filesOf(folder).get('src/shape.ts')?.proofs, undefined);
  assert.equal(result.stdout.split('\n').filter((line) => /difftastic/i.test(line)).length, 1, result.stdout);
  assert.match(result.stdout, /brew install difftastic/);
  assert.match(result.stdout, /cargo install --locked difftastic/);
  for (const installer of installers) assert.deepEqual(installer.log(), []);
});

// CI installs difftastic, so there these run for sure; elsewhere they need it installed.
test(
  'with the real difftastic, proves reflows and re-indentation, never a changed tree',
  { skip: !realDifftDir && !process.env.CI && 'difftastic is not installed' },
  () => {
    assert.ok(realDifftDir, 'CI must install difftastic');
    const { repo, folder } = prepareChange(sandbox, {
      trunk: {
        'src/shape.ts': compact,
        'src/hidden.ts': compact,
        'jobs/reindented.py': 'for item in items:\n  load(item)\nsave()\n',
        'jobs/renested.py': 'for item in items:\n    load(item)\nsave()\n',
      },
      feature: {
        'src/shape.ts': reflowed,
        'src/hidden.ts': reflowed.replace('a * b', 'a + b'),
        'jobs/reindented.py': 'for item in items:\n    load(item)\nsave()\n',
        'jobs/renested.py': 'for item in items:\n    load(item)\n    save()\n',
      },
    });

    const result = sandbox.run(['prepare', 'feature', '--base', 'trunk'], {
      cwd: repo.dir,
      env: { PATH: `${realDifftDir}${path.delimiter}${sandbox.env.PATH}` },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /difftastic/i);
    const files = filesOf(folder);
    assert.deepEqual(files.get('src/shape.ts')?.proofs, ['syntax-identical']);
    assert.deepEqual(files.get('jobs/reindented.py')?.proofs, ['syntax-identical']);
    assert.equal(files.get('src/hidden.ts')?.proofs, undefined);
    assert.equal(files.get('jobs/renested.py')?.proofs, undefined);
  },
);

test("the reviewer's difftastic settings can't loosen the proof", () => {
  fakeDifft(sandbox);
  const { repo, folder } = prepareChange(sandbox, {
    trunk: { 'src/limit.ts': 'export const limit = 1; // per user\n' },
    feature: { 'src/limit.ts': 'export const limit = 1; // per account\n' },
  });

  const result = sandbox.run(['prepare', 'feature', '--base', 'trunk'], {
    cwd: repo.dir,
    env: { DFT_IGNORE_COMMENTS: '1' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(filesOf(folder).get('src/limit.ts')?.proofs, undefined);
});
