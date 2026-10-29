import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { breakout, hostileName, payloads, renderHostileTour } from '../support/hostile.ts';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';
import { prepareChange, stepText, writePlan } from '../support/tour.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.cleanup());

const render = (folder: string, cwd: string) => sandbox.run(['render', folder], { cwd });
const pageOf = (folder: string) => fs.readFileSync(path.join(folder, 'tour.html'), 'utf8');

test('shows each callout inline, right after the line it is anchored to', () => {
  const { folder, repo } = prepareChange(sandbox, {
    trunk: { 'a.txt': 'one\ntwo\nthree\n' },
    feature: { 'a.txt': 'one\nTWO\nthree\nfour\n' },
  });
  writePlan(folder, {
    steps: [
      {
        title: 'A',
        files: ['a.txt'],
        explanation: '',
        callouts: [
          { file: 'a.txt', line: 2, side: 'old', tag: 'Breaking', text: 'Lower case is gone.' },
          { file: 'a.txt', line: 4, side: 'new', tag: 'One-way door', text: 'Four cannot be removed later.' },
        ],
      },
    ],
  });

  const result = render(folder, repo.dir);

  assert.equal(result.status, 0, result.stderr);
  const step = stepText(pageOf(folder), 1);
  assert.match(step, /-two\s*Breaking\s*Lower case is gone\.\s*2?\s*\+TWO/);
  assert.match(step, /\+four\s*One-way door\s*Four cannot be removed later\./);
});

test('rejects unknown callout tags and anchors outside a hunk, on the wrong side or in another step', () => {
  const twenty = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
  const { folder, repo } = prepareChange(sandbox, {
    trunk: { 'a.txt': `${twenty.join('\n')}\n`, 'b.txt': 'one\n' },
    feature: { 'a.txt': `${twenty.with(1, 'LINE 2').join('\n')}\n`, 'b.txt': 'one\ntwo\nthree\n' },
  });
  writePlan(folder, {
    steps: [
      {
        title: 'A',
        files: ['a.txt'],
        explanation: '',
        callouts: [
          { file: 'a.txt', line: 15, side: 'new', tag: 'Subtle', text: 'Far from the hunk.' },
          { file: 'a.txt', line: 2, side: 'new', tag: 'Nit', text: 'Not a tag.' },
          { file: 'b.txt', line: 2, side: 'new', tag: 'Perf', text: 'Belongs to step 2.' },
        ],
      },
      {
        title: 'B',
        files: ['b.txt'],
        explanation: '',
        callouts: [{ file: 'b.txt', line: 3, side: 'old', tag: 'Security', text: 'Only added lines here.' }],
      },
    ],
  });

  const result = render(folder, repo.dir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /step 1, callout 1: new line 15 of a\.txt is outside every hunk/);
  assert.match(
    result.stderr,
    /step 1, callout 2: unknown tag "Nit"; use Subtle, Breaking, Security, Perf, Concurrency or One-way door/,
  );
  assert.match(result.stderr, /step 1, callout 3: b\.txt is not in this step/);
  assert.match(result.stderr, /step 2, callout 1: line 3 of b\.txt is on the new side, not the old/);
  assert.ok(!fs.existsSync(path.join(folder, 'tour.html')));
});

test('lists the reviewer questions of each step before its diffs', () => {
  const { folder, repo } = prepareChange(sandbox, { trunk: {}, feature: { 'a.txt': 'a\n' } });
  writePlan(folder, {
    steps: [
      {
        title: 'A',
        files: ['a.txt'],
        explanation: 'Adds a.',
        questions: ['Should a exist at all?', 'Who reads a?'],
      },
    ],
  });

  const result = render(folder, repo.dir);

  assert.equal(result.status, 0, result.stderr);
  assert.match(stepText(pageOf(folder), 1), /Adds a\.\s*Reviewer questions\s*Should a exist at all\?\s*Who reads a\?[\s\S]*\+a/);
});

test('shows a step\'s pseudocode as written, before its diffs', () => {
  const { folder, repo } = prepareChange(sandbox, { trunk: {}, feature: { 'a.txt': 'a\n' } });
  writePlan(folder, {
    steps: [
      { title: 'A', files: ['a.txt'], explanation: '', pseudocode: 'if token expired:\n    refresh **it**' },
    ],
  });

  const result = render(folder, repo.dir);

  assert.equal(result.status, 0, result.stderr);
  assert.match(stepText(pageOf(folder), 1), /Pseudocode\s*if token expired:\n {4}refresh \*\*it\*\*[\s\S]*\+a/);
});

test('shows a trace of one input through the old and new code, marking where they diverge', () => {
  const { folder, repo } = prepareChange(sandbox, { trunk: {}, feature: { 'a.txt': 'a\n' } });
  writePlan(folder, {
    steps: [
      {
        title: 'A',
        files: ['a.txt'],
        explanation: '',
        trace: {
          input: 'a request with retries = 3',
          old: ['call once', 'fail on timeout'],
          new: ['call once', 'retry after timeout', 'succeed'],
        },
      },
    ],
  });

  const result = render(folder, repo.dir);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    stepText(pageOf(folder), 1),
    /Old versus new\s*Input: a request with retries = 3\s*Old\s*New\s*=\s*call once\s*call once\s*≠\s*fail on timeout\s*retry after timeout\s*≠\s*succeed[\s\S]*\+a/,
  );
});

test('rejects malformed reading aids, listing every violation at once', () => {
  const { folder, repo } = prepareChange(sandbox, { trunk: {}, feature: { 'a.txt': 'a\n', 'b.txt': 'b\n' } });
  writePlan(folder, {
    steps: [
      {
        title: 'A',
        files: ['a.txt'],
        explanation: '',
        questions: 'Why?',
        pseudocode: 3,
        trace: { input: 'x', old: 'a' },
        callouts: [{ file: 'a.txt', line: '1', side: 'left', tag: 7 }, 'loud'],
      },
      { title: 'B', files: ['b.txt'], explanation: '', callouts: 'none' },
    ],
  });

  const result = render(folder, repo.dir);

  assert.equal(result.status, 1);
  for (const violation of [
    'step 1: "questions" must be a list of text',
    'step 1: "pseudocode" must be text',
    'step 1: "trace" must have text "input" and lists of text "old" and "new"',
    'step 1, callout 1: "line" must be a line number',
    'step 1, callout 1: "side" must be "old" or "new"',
    'step 1, callout 1: "tag" must be text',
    'step 1, callout 1: "text" must be text',
    'step 1, callout 2 must be an object',
    'step 2: "callouts" must be a list',
  ]) {
    assert.ok(result.stderr.includes(violation), `missing "${violation}" in:\n${result.stderr}`);
  }
});

test('renders prose as a Markdown subset: code spans, bold, lists and https links', () => {
  const { folder, repo } = prepareChange(sandbox, { trunk: {}, feature: { 'a.txt': 'a\n' } });
  writePlan(folder, {
    steps: [
      {
        title: 'A',
        files: ['a.txt'],
        explanation:
          'Calls `retry()` **twice**:\n- first, per [the docs](https://example.com/a?b=1&c=2)\n- then `**not bold**`\n\n1. one\n2. two',
        questions: ['Is `x` **safe**?'],
        callouts: [{ file: 'a.txt', line: 1, side: 'new', tag: 'Subtle', text: 'Uses `y`.' }],
        trace: { input: '`n = 0`', old: ['**stops**'], new: ['loops'] },
      },
    ],
  });

  const result = render(folder, repo.dir);

  assert.equal(result.status, 0, result.stderr);
  const html = pageOf(folder);
  assert.ok(html.includes('<p>Calls <code>retry()</code> <strong>twice</strong>:</p>'), html);
  assert.match(html, /<ul><li>first, per <a [^>]*href="https:\/\/example\.com\/a\?b=1&amp;c=2"[^>]*>the docs<\/a><\/li>/);
  assert.ok(html.includes('<li>then <code>**not bold**</code></li></ul>'));
  assert.ok(html.includes('<ol><li>one</li><li>two</li></ol>'));
  assert.ok(html.includes('<li>Is <code>x</code> <strong>safe</strong>?</li>'));
  assert.ok(html.includes('Uses <code>y</code>.'));
  assert.ok(html.includes('Input: <code>n = 0</code>'));
  assert.ok(html.includes('<strong>stops</strong>'));
});

test('keeps raw HTML and non-https links in prose as plain text', () => {
  const { folder, repo } = prepareChange(sandbox, { trunk: {}, feature: { 'a.txt': 'a\n' } });
  writePlan(folder, {
    steps: [
      {
        title: 'A',
        files: ['a.txt'],
        explanation: 'See <b>this</b>, [that](javascript:alert(1)), [plain](http://example.com) and [data](data:text/html,x).',
      },
    ],
  });

  const result = render(folder, repo.dir);

  assert.equal(result.status, 0, result.stderr);
  const html = pageOf(folder);
  assert.ok(
    html.includes(
      'See &lt;b&gt;this&lt;/b&gt;, [that](javascript:alert(1)), [plain](http://example.com) and [data](data:text/html,x).',
    ),
  );
  assert.doesNotMatch(html, /href="(?!#step-)/);
});

test('escapes hostile text in prose, file names and diffs, keeping it readable', () => {
  const html = fs.readFileSync(renderHostileTour(sandbox), 'utf8');

  const body = html.slice(html.indexOf('<body>'));
  assert.doesNotMatch(body, /<(script|img|svg|iframe|style)\b/i);
  assert.doesNotMatch(body, /<[^>]*\son[a-z]+\s*=/i, 'an event-handler attribute reached the markup');
  for (const [, href] of body.matchAll(/href="([^"]*)"/g)) {
    assert.match(href, /^(#step-\d+|https:\/\/)/, `unexpected link target ${href}`);
  }
  assert.ok(body.includes('href="https://example.invalid/&quot;onmouseover=&quot;window.__pwned=1"'));
  const step = stepText(html, 1);
  for (const payload of [...payloads, hostileName]) {
    assert.ok(step.includes(payload), `"${payload}" is not shown as text`);
  }
  assert.ok(!step.includes(breakout));
});

test('renders the intent\'s why and blast radius as inline Markdown', () => {
  const { folder, repo } = prepareChange(sandbox, { trunk: {}, feature: { 'a.txt': 'a\n' } });
  writePlan(folder, {
    intent: {
      why: 'Sessions start with **expired** tokens.\nCheck `expiresAt` first.',
      visual: 'start()',
      mergeDanger: { door: 'two-way', blastRadius: 'the `session` module' },
    },
    steps: [{ title: 'A', files: ['a.txt'], explanation: '' }],
  });

  const result = render(folder, repo.dir);

  assert.equal(result.status, 0, result.stderr);
  const html = pageOf(folder);
  assert.ok(html.includes('Sessions start with <strong>expired</strong> tokens.\nCheck <code>expiresAt</code> first.'));
  assert.ok(html.includes('blast radius: the <code>session</code> module'));
});
