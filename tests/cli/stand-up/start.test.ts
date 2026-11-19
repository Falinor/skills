import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { makeStandUpSandbox, workFolder, type StandUpSandbox } from '../../support/stand-up.ts';

let sandbox: StandUpSandbox;
afterEach(() => sandbox.cleanup());

const context = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, 'context.json'), 'utf8'));

test('creates the work folder and reports from the last day with activity', () => {
  sandbox = makeStandUpSandbox('2026-11-19', { events: ['2026-11-18T16:00:00Z', '2026-11-12T09:00:00Z'] });

  const result = sandbox.run(['start']);

  assert.equal(result.status, 0, result.stderr);
  const folder = workFolder(sandbox, '2026-11-19');
  assert.match(result.stdout, new RegExp(`Work folder: ${folder}`));
  assert.match(result.stdout, /Last activity: 2026-11-18/);
  assert.match(result.stdout, /Period: 2026-11-18 to 2026-11-18/);
  assert.deepEqual(context(folder), { today: '2026-11-19', since: '2026-11-18', until: '2026-11-18', lang: 'en' });
});

test('skips days without activity: Tuesday worked, Wednesday off, back on Thursday', () => {
  sandbox = makeStandUpSandbox('2026-11-19', {
    events: ['2026-11-19T08:30:00Z', '2026-11-17T17:45:00Z', '2026-11-16T10:00:00Z'],
  });

  const result = sandbox.run(['start']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Last activity: 2026-11-17/);
  assert.match(result.stdout, /Period: 2026-11-17 to 2026-11-18/);
});

test('counts commits not pushed yet as activity', () => {
  sandbox = makeStandUpSandbox('2026-11-19', { events: ['2026-11-13T11:00:00Z'] });
  sandbox.commitAt('2026-11-18T19:00:00Z');
  sandbox.commitAt('2026-11-19T07:00:00Z');

  const result = sandbox.run(['start']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Last activity: 2026-11-18/);
});

test('without any activity before today, starts on the previous weekday and says so', () => {
  sandbox = makeStandUpSandbox('2026-11-23');

  const result = sandbox.run(['start']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No activity found before today: starting on the previous weekday/);
  assert.match(result.stdout, /Period: 2026-11-20 to 2026-11-22/);
});

test('--since sets the first day of the period', () => {
  sandbox = makeStandUpSandbox('2026-11-19');

  const result = sandbox.run(['start', '--since', '2026-11-14']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Period: 2026-11-14 to 2026-11-18/);
});

test('refuses a --since that is not a past day', () => {
  sandbox = makeStandUpSandbox('2026-11-19');

  for (const since of ['2026-11-19', '2026-11-25', 'last friday', '2026-02-30']) {
    const result = sandbox.run(['start', '--since', since]);
    assert.equal(result.status, 1, since);
    assert.match(result.stderr, /--since/, since);
  }
});

test('--lang records the page language in canonical form', () => {
  sandbox = makeStandUpSandbox('2026-11-19');

  const result = sandbox.run(['start', '--lang', 'FR']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Language: fr/);
  assert.equal(context(workFolder(sandbox, '2026-11-19')).lang, 'fr');
});

test('refuses a --lang that is not a language tag', () => {
  sandbox = makeStandUpSandbox('2026-11-19');

  const result = sandbox.run(['start', '--lang', 'not a language']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--lang/);
});

test('stops when gh is not installed', () => {
  sandbox = makeStandUpSandbox('2026-11-19', { gh: 'missing' });

  const result = sandbox.run(['start']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /needs gh, which is not on PATH/);
  assert.match(result.stderr, /gh auth login/);
});

test('stops when gh is not logged in', () => {
  sandbox = makeStandUpSandbox('2026-11-19', { gh: 'logged-out' });

  const result = sandbox.run(['start']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /gh is not logged in: run `gh auth login`/);
});
