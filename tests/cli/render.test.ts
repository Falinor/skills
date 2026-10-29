import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';
import { prepareChange, stepText, writePlan } from '../support/tour.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.cleanup());

test('renders each step under #step-N with its escaped explanation and the real diffs', () => {
  const { folder, repo } = prepareChange(sandbox, {
    trunk: { 'a.txt': 'one\n' },
    feature: { 'a.txt': 'one\ntwo\n', 'b.txt': 'brand new\n' },
  });
  writePlan(folder, {
    steps: [
      { title: 'Grow <b>a</b>', files: ['a.txt'], explanation: '<script>alert(1)</script> & more' },
      { title: 'Add b', files: ['b.txt'], explanation: 'Adds b.' },
    ],
  });

  const result = sandbox.run(['render', folder], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  const page = path.join(folder, 'tour.html');
  assert.ok(result.stdout.includes(page), result.stdout);
  const html = fs.readFileSync(page, 'utf8');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more'));
  assert.ok(html.includes('Grow &lt;b&gt;a&lt;/b&gt;'));
  assert.ok(!html.includes('<script>alert(1)') && !html.includes('<b>a</b>'));
  const first = stepText(html, 1);
  assert.match(first, /a\.txt/);
  assert.match(first, /\+two/);
  assert.doesNotMatch(first, /b\.txt|brand new/);
  const second = stepText(html, 2);
  assert.match(second, /b\.txt/);
  assert.match(second, /\+brand new/);
});

test('rejects a plan that misses or repeats files, listing every violation at once', () => {
  const { folder, repo } = prepareChange(sandbox, {
    trunk: {},
    feature: { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' },
  });
  writePlan(folder, {
    steps: [
      { title: 'One', files: ['b.txt', 'x.txt'], explanation: '' },
      { title: 'Two', files: ['b.txt'], explanation: '' },
    ],
  });

  const result = sandbox.run(['render', folder], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /a\.txt is in no step/);
  assert.match(result.stderr, /c\.txt is in no step/);
  assert.match(result.stderr, /b\.txt is in steps 1 and 2/);
  assert.match(result.stderr, /x\.txt is not part of the change/);
  assert.ok(!fs.existsSync(path.join(folder, 'tour.html')));
});

test('rejects a malformed plan, listing every violation at once', () => {
  const { folder, repo } = prepareChange(sandbox, { trunk: {}, feature: { 'a.txt': 'a\n' } });
  writePlan(folder, { steps: [{ files: 'a.txt', explanation: 3 }, 'not a step'] });

  const result = sandbox.run(['render', folder], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /step 1: "title" must be text/);
  assert.match(result.stderr, /step 1: "files" must be a list of paths/);
  assert.match(result.stderr, /step 1: "explanation" must be text/);
  assert.match(result.stderr, /step 2 must be an object/);
});

test('rejects a plan that is not JSON', () => {
  const { folder, repo } = prepareChange(sandbox, { trunk: {}, feature: { 'a.txt': 'a\n' } });
  fs.writeFileSync(path.join(folder, 'plan.json'), '{ steps: [');

  const result = sandbox.run(['render', folder], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan\.json is not valid JSON/);
});

test('cuts each file of a mixed change into its own step', () => {
  const { folder, repo } = prepareChange(
    sandbox,
    {
      trunk: { 'a.txt': 'a1\n', 'd.txt': 'gone\n', 'r.txt': 'line1\nline2\nline3\nline4\n' },
      feature: { 'a.txt': 'a1\na2\n', 'd.txt': null, 's.txt': 'line1\nline2\nline3\nLINE4\n', 'img.bin': 'PNG\0\x01\x02' },
    },
    { 'r.txt': 's.txt' },
  );
  writePlan(folder, {
    steps: ['a.txt', 'd.txt', 's.txt', 'img.bin'].map((file) => ({ title: file, files: [file], explanation: '' })),
  });

  const result = sandbox.run(['render', folder], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(path.join(folder, 'tour.html'), 'utf8');
  assert.match(stepText(html, 1), /\+a2/);
  assert.doesNotMatch(stepText(html, 1), /gone|LINE4/);
  assert.match(stepText(html, 2), /-gone/);
  assert.match(stepText(html, 3), /r\.txt → s\.txt/);
  assert.match(stepText(html, 3), /-line4[\s\S]*\+LINE4/);
  assert.match(stepText(html, 4), /img\.bin[\s\S]*binary/i);
  assert.doesNotMatch(stepText(html, 4), /LINE4/);
});

test('opens the page with the platform opener when asked', () => {
  const { folder, repo } = prepareChange(sandbox, { trunk: {}, feature: { 'a.txt': 'a\n' } });
  writePlan(folder, { steps: [{ title: 'A', files: ['a.txt'], explanation: '' }] });
  const openers = [sandbox.fake('open'), sandbox.fake('xdg-open')];

  const result = sandbox.run(['render', folder, '--open'], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    openers.flatMap((opener) => opener.log()),
    [[path.join(folder, 'tour.html')]],
  );
});
