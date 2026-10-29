// The agent eval harness, driven from the outside without any model call:
// the fixture builder through `prepare`, the grader on hand-written tour
// plans, and the harness with a fake agent on PATH.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';

const evals = path.join(import.meta.dirname, '../../evals/review-tour');

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.cleanup());

type File = { path: string; proofs?: string[]; generated?: string };

/** Builds the fixture into the sandbox and captures it with `prepare`, as the agent would. */
function prepareFixture(): { repo: string; folder: string } {
  const repo = path.join(sandbox.root, 'shop');
  const built = spawnSync(process.execPath, [path.join(evals, 'fixture.ts'), repo], { env: sandbox.env, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const prepared = sandbox.run(['prepare', 'feature', '--base', 'trunk'], { cwd: repo });
  assert.equal(prepared.status, 0, prepared.stderr);
  return { repo, folder: path.join(sandbox.tmp, 'review-tour', 'shop-feature') };
}

function filesOf(folder: string): Map<string, File> {
  const change = JSON.parse(fs.readFileSync(path.join(folder, 'change.json'), 'utf8'));
  return new Map(change.files.map((file: File) => [file.path, file]));
}

test('the fixture holds a cross-file move, a rename, a reformat, a generated file, wiring and a hidden behaviour change', () => {
  const { repo, folder } = prepareFixture();

  const files = filesOf(folder);
  assert.deepEqual(
    [...files.keys()].sort(),
    ['src/cart.ts', 'src/discount.ts', 'src/format.ts', 'src/generated/catalog.ts', 'src/index.ts', 'src/money.ts', 'src/text.ts'],
  );
  // A function leaves money.ts and lands in format.ts: a move between files, never a reorder within one.
  assert.deepEqual(files.get('src/money.ts')?.proofs, ['pure-move']);
  assert.deepEqual(files.get('src/format.ts')?.proofs, ['pure-move']);
  assert.deepEqual(files.get('src/text.ts')?.proofs, ['pure-rename']);
  assert.deepEqual(files.get('src/cart.ts')?.proofs, ['whitespace-only']);
  assert.equal(files.get('src/generated/catalog.ts')?.generated, 'base');
  for (const unproven of ['src/index.ts', 'src/discount.ts']) {
    assert.equal(files.get(unproven)?.proofs, undefined, unproven);
    assert.equal(files.get(unproven)?.generated, undefined, unproven);
  }
  // The hidden change: a whole file re-indented, with one line that also changes behaviour.
  const discount = spawnSync('git', ['diff', '--numstat', 'trunk', 'feature', '--', 'src/discount.ts'], { cwd: repo, encoding: 'utf8' });
  const ignoringWhitespace = spawnSync('git', ['diff', '-w', '--numstat', 'trunk', 'feature', '--', 'src/discount.ts'], { cwd: repo, encoding: 'utf8' });
  assert.ok(Number(discount.stdout.split('\t')[0]) >= 10, discount.stdout);
  assert.match(ignoringWhitespace.stdout, /^1\t1\t/);
  assert.match(fs.readFileSync(path.join(folder, 'to-read.patch'), 'utf8'), /^diff --git a\/src\/discount\.ts/m);
});
