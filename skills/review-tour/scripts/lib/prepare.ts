import path from 'node:path';
import { parseCommandArgs } from './args.ts';
import { UserError } from './errors.ts';
import { capturePatch, commitOf, git, listChangedFiles, tryGit } from './git.ts';
import { workFolderFiles, workFolderFor, writeCapture, type Change } from './work-folder.ts';

const usage = 'usage: review-tour prepare <branch> [--base <ref>]';

/** The remote's default branch, as `<remote>/<branch>`. Never assumes a name. */
function defaultBase(root: string): string {
  const remote = 'origin';
  const local = tryGit(root, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`]);
  if (local.status === 0) return local.stdout.trim();
  // origin/HEAD is often unset (`git remote add` never sets it): ask the remote.
  const remoteHead = tryGit(root, ['ls-remote', '--symref', remote, 'HEAD']);
  const branch = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(remoteHead.stdout)?.[1];
  if (!branch) {
    throw new UserError(
      `no base: "${remote}" has no default branch to compare against. Name one with --base <ref>.`,
    );
  }
  return `${remote}/${branch}`;
}

/** Captures the change into its work folder, before the agent reads anything. */
export function prepare(args: string[]): void {
  const { values, positionals } = parseCommandArgs(args, { base: { type: 'string' } }, usage, 1);
  const [target] = positionals;

  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
  const head = commitOf(root, target);
  if (!head) throw new UserError(`no branch or commit named "${target}" in ${root}.`);
  const base = values.base ?? defaultBase(root);
  const baseCommit = commitOf(root, base);
  if (!baseCommit) throw new UserError(`base "${base}" names no commit.`);
  const mergeBase = git(root, ['merge-base', baseCommit, head]).trim();

  const change: Change = {
    repository: path.basename(root),
    target,
    base,
    mergeBase,
    head,
    files: listChangedFiles(root, mergeBase, head),
  };
  const folder = workFolderFor(change.repository, target);
  writeCapture(folder, change, capturePatch(root, mergeBase, head));

  console.log(
    [
      `Change: ${target} against ${base} (merge base ${mergeBase.slice(0, 12)}, head ${head.slice(0, 12)}), ${change.files.length} files.`,
      `Work folder: ${folder}`,
      `  ${workFolderFiles.change}  base, head and every changed file with its line counts`,
      `  ${workFolderFiles.patch}  the captured patch`,
      `Next: write the tour plan to ${path.join(folder, workFolderFiles.plan)}, then run: render ${folder}`,
    ].join('\n'),
  );
}
