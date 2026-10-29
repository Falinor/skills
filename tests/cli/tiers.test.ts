import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';
import { prepareChange, sampleIntent, stepText, writePlan } from '../support/tour.ts';

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

test('presents core logic, then wiring, then the mechanical tier as tables without diffs', () => {
  const { folder, repo } = prepareMixedChange();
  writePlan(folder, {
    steps: [
      { title: 'Regenerate', tier: 'core-logic', files: ['gen.ts'], unprovenMechanical: ['gen.ts'], explanation: '' },
      { title: 'Raise the limit', tier: 'wiring', files: ['logic.ts'], explanation: '' },
      { title: 'Noise', tier: 'mechanical', files: ['new.ts', 'dist/app.js'], explanation: 'Proven or declared.' },
    ],
  });

  const result = sandbox.run(['render', folder], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(path.join(folder, 'tour.html'), 'utf8');
  const headings = [...html.matchAll(/<h2 id="tier-[^>]*>([^<]*)<\/h2>/g)].map((match) => match[1]);
  assert.deepEqual(headings, ['Core logic', 'Wiring', 'Mechanical']);
  assert.ok(html.indexOf('id="step-1"') < html.indexOf('>Wiring</h2>'));
  assert.ok(html.indexOf('>Wiring</h2>') < html.indexOf('id="step-2"'));
  assert.ok(html.indexOf('id="step-2"') < html.indexOf('>Mechanical</h2>'));
  assert.match(stepText(html, 1), /gen\.ts\s*Unproven mechanical/);
  assert.match(stepText(html, 1), /\+export const injected = 1;/);
  assert.match(stepText(html, 2), /\+export const limit = 2;/);
  assert.doesNotMatch(stepText(html, 2), /Unproven mechanical/);

  const mechanical = stepText(html, 3);
  assert.match(mechanical, /Proven or declared\./);
  assert.match(mechanical, /File\s*Added\s*Removed\s*Proof/);
  assert.match(mechanical, /old\.ts → new\.ts\s*0\s*0\s*pure rename/);
  assert.match(mechanical, /Declared generated[\s\S]*dist\/app\.js\s*1\s*1\s*declared, not proven/);
  assert.ok(mechanical.indexOf('pure rename') < mechanical.indexOf('Declared generated'));
  assert.doesNotMatch(mechanical, /fresh|kept/);
});
