import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';
import { prepareChange, sampleIntent, writePlan } from '../support/tour.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.cleanup());

const body = 'export function kept(value: number): number {\n  return value * 3 - 1;\n}\n';

/** logic.ts (no proof), new.ts (pure rename), dist/app.js (declared by the base), gen.ts (declared by the change). */
function prepareMixedChange() {
  return prepareChange(
    sandbox,
    {
      trunk: {
        '.gitattributes': 'dist/** linguist-generated\n',
        'dist/app.js': 'old();\n',
        'old.ts': body,
        'logic.ts': 'export const limit = 1;\n',
      },
      feature: {
        'dist/app.js': 'fresh();\n',
        'logic.ts': 'export const limit = 2;\n',
        'gen.ts': '// @generated\nexport const injected = 1;\n',
      },
    },
    { 'old.ts': 'new.ts' },
  );
}

test('rejects a step without a known tier', () => {
  const { folder, repo } = prepareChange(sandbox, { trunk: {}, feature: { 'a.txt': 'a\n', 'b.txt': 'b\n' } });
  // Written by hand: writePlan would put the tierless step in core logic.
  const steps = [
    { title: 'A', files: ['a.txt'], explanation: '' },
    { title: 'B', tier: 'boilerplate', files: ['b.txt'], explanation: '' },
  ];
  fs.writeFileSync(path.join(folder, 'plan.json'), JSON.stringify({ intent: sampleIntent, steps }));

  const result = sandbox.run(['render', folder], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /step 1: "tier" must be one of core-logic, wiring, mechanical/);
  assert.match(result.stderr, /step 2: "tier" must be one of core-logic, wiring, mechanical/);
});

test('rejects steps out of tier order', () => {
  const { folder, repo } = prepareChange(sandbox, { trunk: {}, feature: { 'a.txt': 'a\n', 'b.txt': 'b\n' } });
  writePlan(folder, {
    steps: [
      { title: 'Wire', tier: 'wiring', files: ['a.txt'], explanation: '' },
      { title: 'Logic', tier: 'core-logic', files: ['b.txt'], explanation: '' },
    ],
  });

  const result = sandbox.run(['render', folder], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /step 2 \(core-logic\) comes after a wiring step/);
});

test('rejects a file in the mechanical tier without a proof, even one the change declares generated', () => {
  const { folder, repo } = prepareMixedChange();
  writePlan(folder, {
    steps: [{ title: 'Noise', tier: 'mechanical', files: ['logic.ts', 'new.ts', 'dist/app.js', 'gen.ts'], explanation: '' }],
  });

  const result = sandbox.run(['render', folder], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /step 1: logic\.ts has no mechanical proof/);
  assert.match(result.stderr, /step 1: gen\.ts has no mechanical proof/);
  assert.doesNotMatch(result.stderr, /new\.ts|dist\/app\.js/);
  assert.ok(!fs.existsSync(path.join(folder, 'tour.html')));
});

test('rejects unproven mechanical flags outside core logic or on files the step does not hold', () => {
  const { folder, repo } = prepareMixedChange();
  writePlan(folder, {
    steps: [
      { title: 'Logic', tier: 'core-logic', files: ['logic.ts'], unprovenMechanical: ['gen.ts'], explanation: '' },
      { title: 'Generated', tier: 'wiring', files: ['gen.ts'], unprovenMechanical: ['gen.ts'], explanation: '' },
      { title: 'Noise', tier: 'mechanical', files: ['new.ts', 'dist/app.js'], explanation: '' },
    ],
  });

  const result = sandbox.run(['render', folder], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /step 1: gen\.ts is flagged unproven mechanical but is not in this step/);
  assert.match(result.stderr, /step 2: gen\.ts is flagged unproven mechanical, which only core-logic steps hold/);
});
