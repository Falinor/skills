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
function diff(cwd: string, args: string[]): string {
  return git(cwd, [
    '-c', 'core.quotePath=false',
    'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--default-prefix', '--no-relative', '-M',
    ...args,
  ]);
}

/** The full patch from `from` to `to`, one `diff --git` section per changed file. */
export function capturePatch(cwd: string, from: string, to: string): string {
  return diff(cwd, [from, to]);
}

/** Every changed file with its status and line counts, in patch order. */
export function listChangedFiles(cwd: string, from: string, to: string): ChangedFile[] {
  const raw = diff(cwd, ['--raw', '-z', '--no-abbrev', from, to]).split('\0');
  const numstat = diff(cwd, ['--numstat', '-z', from, to]).split('\0');

  const files: ChangedFile[] = [];
  for (let i = 0; i < raw.length && raw[i]; ) {
    const status = raw[i++].split(' ')[4][0];
    const file: ChangedFile =
      status === 'R' || status === 'C'
        ? { oldPath: raw[i++], path: raw[i++], status, additions: null, deletions: null }
        : { path: raw[i++], status, additions: null, deletions: null };
    files.push(file);
  }

  let index = 0;
  for (let i = 0; i < numstat.length && numstat[i]; index++) {
    const [additions, deletions, path] = numstat[i++].split('\t');
    if (path === '') i += 2; // rename or copy: old and new paths follow
    files[index].additions = additions === '-' ? null : Number(additions);
    files[index].deletions = deletions === '-' ? null : Number(deletions);
  }
  return files;
}
