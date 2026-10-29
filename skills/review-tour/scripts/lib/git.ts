import { spawnSync } from 'node:child_process';
import type { ChangedFile } from './work-folder.ts';
import { UserError } from './errors.ts';

export type GitResult = { status: number | null; stdout: string; stderr: string };

/** Runs git without throwing; for commands whose failure is an answer. */
export function tryGit(cwd: string, args: string[]): GitResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 ** 3,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Runs git and returns its stdout; a failure stops the tool with git's message. */
export function git(cwd: string, args: string[]): string {
  const result = tryGit(cwd, args);
  if (result.status !== 0) {
    throw new UserError(`git ${args.join(' ')} failed:\n${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** The commit id `ref` names, or undefined when it names no commit. */
export function commitOf(cwd: string, ref: string): string | undefined {
  const result = tryGit(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  return result.status === 0 ? result.stdout.trim() : undefined;
}

// Neutralise user configuration that changes diff output (external diff
// tools, prefixes, colours, textconv, relative paths). Every diff of one
// change uses the same flags, so listings and the patch list files in the
// same order.
function diff(cwd: string, args: string[], config: string[] = []): string {
  return git(cwd, [
    '-c', 'core.quotePath=false',
    ...config,
    'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--default-prefix', '--no-relative', '-M',
    ...args,
  ]);
}

/**
 * Each blob's content, keyed by the object name asked for (a blob id or
 * `<tree-ish>:<path>`); names that resolve to nothing are left out. Content
 * is decoded byte for byte (latin1) so that two different blobs never read
 * the same, whatever their encoding.
 */
export function readBlobs(cwd: string, names: string[]): Map<string, string> {
  const unique = [...new Set(names)];
  const blobs = new Map<string, string>();
  if (unique.length === 0) return blobs;
  const result = spawnSync('git', ['cat-file', '--batch', '-z'], {
    cwd,
    input: unique.map((name) => `${name}\0`).join(''),
    maxBuffer: 1024 ** 3,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new UserError(`git cat-file --batch failed:\n${result.stderr.toString().trim()}`);
  // Each object comes as `<id> <type> <size>\n<content>\n`, a missing one as `<name> missing\n`.
  let offset = 0;
  for (const name of unique) {
    const headerEnd = result.stdout.indexOf(10, offset);
    const header = result.stdout.toString('latin1', offset, headerEnd).split(' ');
    offset = headerEnd + 1;
    if (header.length !== 3) continue; // missing or ambiguous: no content follows
    const size = Number(header[2]);
    if (header[1] === 'blob') blobs.set(name, result.stdout.toString('latin1', offset, offset + size));
    offset += size + 1;
  }
  return blobs;
}

/** A file's changed lines as git's moved-line detection sees them. */
export type FileMoves = {
  /** Changed lines git does not paint as moved. */
  unmoved: number;
  /** Maximal stretches of adjacent moved lines of one sign, each split into git's moved blocks. */
  runs: { sign: '+' | '-'; blocks: string[][] }[];
};

// Moved lines exist only as colours: pin every slot so each class has its own
// code. zebra alternates two colours between adjacent blocks, so a change of
// colour marks git's block boundary.
const movedCodes = { '-': ['35', '34'], '+': ['36', '33'] } as const;
const moveColours = [
  'oldMoved=magenta', 'oldMovedAlternative=blue', 'newMoved=cyan', 'newMovedAlternative=yellow',
  'old=red', 'new=green', 'meta=normal', 'frag=normal', 'func=normal', 'context=normal', 'whitespace=normal',
].flatMap((setting) => ['-c', `color.diff.${setting}`]);

/** Every changed file's moved lines, in patch order. Moves are detected across the whole range at once. */
export function listMoves(cwd: string, from: string, to: string): FileMoves[] {
  const patch = diff(
    cwd,
    ['--color=always', '--color-moved=zebra', '--color-moved-ws=no', '--ws-error-highlight=none', from, to],
    moveColours,
  );
  const files: FileMoves[] = [];
  let file: FileMoves | undefined;
  let inHunk = false;
  let previous: { sign: string; code: string } | undefined;
  for (const line of patch.split('\n')) {
    const code = /^\x1b\[([0-9;]*)m/.exec(line)?.[1] ?? '';
    const text = line.replace(/\x1b\[[0-9;]*m/g, '');
    const sign = text[0];
    if (text.startsWith('diff --git ')) {
      file = { unmoved: 0, runs: [] };
      files.push(file);
      inHunk = false;
      previous = undefined;
    } else if (text.startsWith('@@')) {
      inHunk = true;
      previous = undefined;
    } else if (file && inHunk && (sign === '+' || sign === '-')) {
      if (!(movedCodes[sign] as readonly string[]).includes(code)) {
        file.unmoved++;
        previous = undefined;
        continue;
      }
      const run = file.runs.at(-1);
      if (previous?.sign !== sign || !run) file.runs.push({ sign, blocks: [[]] });
      else if (previous.code !== code) run.blocks.push([]);
      file.runs.at(-1)?.blocks.at(-1)?.push(text.slice(1));
      previous = { sign, code };
    } else {
      previous = undefined;
    }
  }
  return files;
}

/** The paths that `source`'s `.gitattributes` mark `linguist-generated`. */
export function linguistGenerated(cwd: string, source: string, paths: string[]): Set<string> {
  if (paths.length === 0) return new Set();
  const result = spawnSync('git', ['check-attr', '-z', '--stdin', '--source', source, 'linguist-generated'], {
    cwd,
    input: paths.map((file) => `${file}\0`).join(''),
    encoding: 'utf8',
    maxBuffer: 1024 ** 3,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new UserError(`git check-attr failed:\n${result.stderr.trim()}`);
  // Output is `path\0attribute\0value\0` per path.
  const fields = result.stdout.split('\0');
  const generated = new Set<string>();
  for (let i = 0; i + 2 < fields.length; i += 3) {
    if (fields[i + 2] === 'set' || fields[i + 2] === 'true') generated.add(fields[i]);
  }
  return generated;
}

/** The full patch from `from` to `to`, one `diff --git` section per changed file. */
export function capturePatch(cwd: string, from: string, to: string): string {
  return diff(cwd, [from, to]);
}

/** git's raw listing of one changed file: modes, blob ids and status with its score. */
export type RawEntry = {
  oldMode: string;
  newMode: string;
  /** All zeros when the file did not exist on that side. */
  oldBlob: string;
  newBlob: string;
  /** The status letter and, for renames and copies, the similarity score: `M`, `R100`, `R087`. */
  status: string;
  oldPath?: string;
  path: string;
};

/** Every changed file's raw entry, in patch order. */
export function listRawEntries(cwd: string, from: string, to: string): RawEntry[] {
  const raw = diff(cwd, ['--raw', '-z', '--no-abbrev', from, to]).split('\0');
  const entries: RawEntry[] = [];
  for (let i = 0; i < raw.length && raw[i]; ) {
    const [oldMode, newMode, oldBlob, newBlob, status] = raw[i++].slice(1).split(' ');
    const renamed = status[0] === 'R' || status[0] === 'C';
    const oldPath = renamed ? raw[i++] : undefined;
    entries.push({ oldMode, newMode, oldBlob, newBlob, status, ...(oldPath && { oldPath }), path: raw[i++] });
  }
  return entries;
}

/** Every changed file with its status and line counts, in patch order. */
export function listChangedFiles(cwd: string, from: string, to: string): ChangedFile[] {
  const numstat = diff(cwd, ['--numstat', '-z', from, to]).split('\0');

  const files: ChangedFile[] = listRawEntries(cwd, from, to).map(({ oldPath, path, status }) => ({
    ...(oldPath && { oldPath }),
    path,
    status: status[0],
    additions: null,
    deletions: null,
  }));

  let index = 0;
  for (let i = 0; i < numstat.length && numstat[i]; index++) {
    const [additions, deletions, path] = numstat[i++].split('\t');
    if (path === '') i += 2; // rename or copy: old and new paths follow
    files[index].additions = additions === '-' ? null : Number(additions);
    files[index].deletions = deletions === '-' ? null : Number(deletions);
  }
  return files;
}
