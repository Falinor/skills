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

test('proves code moved verbatim from one file to another', () => {
  const { folder } = prepareChange(sandbox, {
    trunk: { 'src/a.ts': body('alpha') + body('beta'), 'src/b.ts': body('gamma') },
    feature: { 'src/a.ts': body('alpha'), 'src/b.ts': body('gamma') + body('beta') },
  });

  const files = filesOf(folder);
  assert.deepEqual(files.get('src/a.ts')?.proofs, ['pure-move']);
  assert.deepEqual(files.get('src/b.ts')?.proofs, ['pure-move']);
});

test('never proves a move that lands with an edit', () => {
  const { folder } = prepareChange(sandbox, {
    trunk: { 'a.ts': body('alpha') + body('beta'), 'b.ts': body('gamma') },
    feature: { 'a.ts': body('alpha'), 'b.ts': `${body('gamma')}${body('beta')}beta(1);\n` },
  });

  const files = filesOf(folder);
  assert.deepEqual(files.get('a.ts')?.proofs, ['pure-move']);
  assert.equal(files.get('b.ts')?.proofs, undefined);
});

const statements = {
  open: 'openTheConnectionToTheDatabase();\n',
  serve: 'serveEveryIncomingRequestUntilStopped();\n',
  close: 'closeTheConnectionToTheDatabase();\n',
};

test('never proves statements reordered within one file', () => {
  const { open, serve, close } = statements;
  const { folder } = prepareChange(sandbox, {
    trunk: { 'run.ts': open + serve + close },
    feature: { 'run.ts': close + open + serve },
  });

  assert.equal(filesOf(folder).get('run.ts')?.proofs, undefined);
});

test('never proves a reorder hidden by the same lines moving between two other files', () => {
  const { open, serve, close } = statements;
  const { folder } = prepareChange(sandbox, {
    trunk: { 'run.ts': open + serve + close, 'from.ts': close },
    feature: { 'run.ts': close + open + serve, 'from.ts': '', 'to.ts': close },
  });

  const files = filesOf(folder);
  assert.equal(files.get('run.ts')?.proofs, undefined);
  assert.deepEqual(files.get('from.ts')?.proofs, ['pure-move']);
  assert.deepEqual(files.get('to.ts')?.proofs, ['pure-move']);
});

test('records files the base declares generated', () => {
  const { folder } = prepareChange(sandbox, {
    trunk: {
      '.gitattributes': 'dist/** linguist-generated\nlock.json linguist-generated=true\n',
      'dist/app.js': 'old();\n',
      'lock.json': '{}\n',
      'src/schema.ts': '// @generated by schema-tool\nexport type A = 1;\n',
      'src/hand.ts': 'export const a = 1;\n',
    },
    feature: {
      'dist/app.js': 'fresh();\n',
      'dist/added.js': 'added();\n',
      'lock.json': '{"a": 1}\n',
      'src/schema.ts': '// @generated by schema-tool\nexport type A = 2;\n',
      'src/hand.ts': 'export const a = 2;\n',
    },
  });

  const files = filesOf(folder);
  for (const file of ['dist/app.js', 'dist/added.js', 'lock.json', 'src/schema.ts']) {
    assert.equal(files.get(file)?.generated, 'base', file);
  }
  assert.equal(files.get('src/hand.ts')?.generated, undefined);
});

test('records generated declarations made by the change itself apart from the base', () => {
  const { folder } = prepareChange(sandbox, {
    trunk: { 'out/x.js': 'old();\n', 'src/types.ts': 'export type A = 1;\n' },
    feature: {
      '.gitattributes': 'out/** linguist-generated\n',
      'out/x.js': 'evil();\n',
      'src/types.ts': '// @generated\nexport type A = 2;\n',
      'src/new.ts': '/* @generated */\nexport const b = 1;\n',
    },
  });

  const files = filesOf(folder);
  for (const file of ['out/x.js', 'src/types.ts', 'src/new.ts']) assert.equal(files.get(file)?.generated, 'change', file);
  assert.equal(files.get('.gitattributes')?.generated, undefined);
});

test('keeps proven files and base-declared generated files out of the patch the agent reads', () => {
  const { folder } = prepareChange(
    sandbox,
    {
      trunk: {
        '.gitattributes': 'dist/** linguist-generated\n',
        'dist/app.js': 'old();\n',
        'old.ts': body('kept'),
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

  const toRead = fs.readFileSync(path.join(folder, 'to-read.patch'), 'utf8');
  assert.match(toRead, /^diff --git a\/logic\.ts b\/logic\.ts$/m);
  assert.match(toRead, /^\+export const injected = 1;$/m);
  assert.doesNotMatch(toRead, /dist\/app\.js|fresh|new\.ts/);
});

test('names the proven and declared generated files when it finishes', () => {
  const { repo } = prepareChange(
    sandbox,
    {
      trunk: { '.gitattributes': 'dist/** linguist-generated\n', 'dist/app.js': 'old();\n', 'old.ts': body('kept') },
      feature: { 'dist/app.js': 'fresh();\n', 'gen.ts': '// @generated\nexport const b = 1;\n' },
    },
    { 'old.ts': 'new.ts' },
  );

  const result = sandbox.run(['prepare', 'feature', '--base', 'trunk'], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pure rename\s+new\.ts/);
  assert.match(result.stdout, /generated by the base[\s\S]*dist\/app\.js/i);
  assert.match(result.stdout, /generated by this change[\s\S]*gen\.ts/i);
  assert.match(result.stdout, /to-read\.patch/);
});

test('a follow-up tour proves its narrowed range and trusts only the merge base to declare generated files', () => {
  const repo = sandbox.repo();
  repo.write({ 'a.txt': 'one\n' });
  repo.commit('start');
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write({
    'added.ts': body('added'),
    '.gitattributes': 'gen/** linguist-generated\n',
    'gen/client.js': 'call();\n',
    'schema.ts': '// @generated\nexport type A = 1;\n',
  });
  const earlier = repo.commit('first round').slice(0, 12);
  repo.git('mv', 'added.ts', 'renamed.ts');
  repo.write({ 'gen/client.js': 'evil();\n', 'schema.ts': '// @generated\nexport type A = 2;\n' });
  repo.commit('second round');

  const result = sandbox.run(['prepare', 'feature', '--base', 'trunk', '--since', earlier], { cwd: repo.dir });

  assert.equal(result.status, 0, result.stderr);
  const files = filesOf(path.join(sandbox.tmp, 'review-tour', `project-feature-since-${earlier}`));
  assert.deepEqual(files.get('renamed.ts')?.proofs, ['pure-rename']);
  assert.equal(files.get('gen/client.js')?.generated, 'change');
  assert.equal(files.get('schema.ts')?.generated, 'change');
});
