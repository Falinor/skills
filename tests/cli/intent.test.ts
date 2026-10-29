import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';
import { prepareChange } from '../support/tour.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.cleanup());

const steps = [{ title: 'A', files: ['a.txt'], explanation: '' }];

function renderPlan(plan: unknown) {
  const { folder, repo } = prepareChange(sandbox, { trunk: {}, feature: { 'a.txt': 'a\n' } });
  fs.writeFileSync(path.join(folder, 'plan.json'), JSON.stringify(plan));
  return { folder, result: sandbox.run(['render', folder], { cwd: repo.dir }) };
}

test('rejects a plan without an intent', () => {
  const { folder, result } = renderPlan({ steps });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /"intent" is missing/);
  assert.ok(!fs.existsSync(path.join(folder, 'tour.html')));
});

test('rejects an intent whose why runs past three lines, without a visual, or with an unknown door', () => {
  const { result } = renderPlan({
    intent: { why: 'one\ntwo\nthree\nfour', visual: '  ', mergeDanger: { door: 'revolving' } },
    steps,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /intent: "why" has 4 lines; keep it to three at most/);
  assert.match(result.stderr, /intent: "visual" must be text/);
  assert.match(result.stderr, /intent: "mergeDanger\.door" must be "one-way" or "two-way"/);
  assert.match(result.stderr, /intent: "mergeDanger\.blastRadius" must be text/);
});

test('rejects an intent that is not an object', () => {
  const { result } = renderPlan({ intent: 'Because.', steps });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /"intent" must be an object with "why", "visual" and "mergeDanger"/);
});

test('the page opens with the escaped intent: why, visual and merge danger', () => {
  const { folder, result } = renderPlan({
    intent: {
      why: 'Sessions start with <em>expired</em> tokens.\nCheck them first.',
      visual: 'startSession(token)\n+ validateToken(token)  # <throws>',
      mergeDanger: { door: 'one-way', blastRadius: 'sign-in & sessions' },
    },
    steps,
  });

  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(path.join(folder, 'tour.html'), 'utf8');
  const intent = html.search(/<section[^>]*\bid="intent"/);
  assert.notEqual(intent, -1, 'no #intent section');
  assert.ok(intent < html.search(/<section[^>]*\bid="step-1"/), 'the intent comes after step 1');
  const section = html.slice(intent, html.indexOf('</section>', intent));
  assert.ok(section.includes('Sessions start with &lt;em&gt;expired&lt;/em&gt; tokens.\nCheck them first.'));
  assert.ok(section.includes('startSession(token)\n+ validateToken(token)  # &lt;throws&gt;'));
  assert.match(section, /One-way door/);
  assert.match(section, /sign-in &amp; sessions/);
  assert.ok(!html.includes('<em>expired') && !html.includes('<throws>'));
});
