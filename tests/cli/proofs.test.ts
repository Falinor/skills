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

type File = { path: string; proofs?: string[]; generated?: string };

function filesOf(folder: string): Map<string, File> {
  const change = JSON.parse(fs.readFileSync(path.join(folder, 'change.json'), 'utf8'));
  return new Map(change.files.map((file: File) => [file.path, file]));
}

const body = (name: string) =>
  `export function ${name}(value: number): number {\n  const scaled = value * 3;\n  return scaled - 1;\n}\n`;

test('proves a rename without edits, and only that', () => {
  const { folder } = prepareChange(
    sandbox,
    {
      trunk: { 'old.ts': body('kept'), 'edited.ts': body('edited') },
      feature: { 'edited-too.ts': body('editedToo') },
    },
    { 'old.ts': 'new.ts', 'edited.ts': 'edited-too.ts' },
  );

  const files = filesOf(folder);
  assert.deepEqual(files.get('new.ts')?.proofs, ['pure-rename']);
  assert.equal(files.get('edited-too.ts')?.proofs, undefined);
});

test('proves a change of indentation, trailing spaces and blank lines', () => {
  const { folder } = prepareChange(sandbox, {
    trunk: { 'src/a.ts': 'if (ready) {\nstart();\n}\n\n\nstop();\n' },
    feature: { 'src/a.ts': 'if (ready) {\n    start();  \n}\r\nstop();\n\n' },
  });

  assert.deepEqual(filesOf(folder).get('src/a.ts')?.proofs, ['whitespace-only']);
});

test('never proves whitespace changed inside a line', () => {
  const { folder } = prepareChange(sandbox, {
    trunk: { 'joined.ts': "greet('a b');\n", 'widened.ts': "greet('a b');\n" },
    feature: { 'joined.ts': "greet('ab');\n", 'widened.ts': "greet('a  b');\n" },
  });

  const files = filesOf(folder);
  assert.equal(files.get('joined.ts')?.proofs, undefined);
  assert.equal(files.get('widened.ts')?.proofs, undefined);
});

test('never proves whitespace changes where whitespace has meaning', () => {
  const { folder } = prepareChange(sandbox, {
    trunk: {
      'job.py': 'for item in items:\n    load(item)\nsave()\n',
      'config.yml': 'server:\n  port: 80\nhost: a\n',
      Makefile: 'build:\n\tcc main.c\n',
    },
    feature: {
      'job.py': 'for item in items:\n    load(item)\n    save()\n',
      'config.yml': 'server:\n  port: 80\n  host: a\n',
      Makefile: 'build:\n        cc main.c\n',
    },
  });

  const files = filesOf(folder);
  for (const file of ['job.py', 'config.yml', 'Makefile']) assert.equal(files.get(file)?.proofs, undefined, file);
});
