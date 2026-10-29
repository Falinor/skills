// difftastic, when installed, proves a file syntax-identical: its syntax tree
// is unchanged, so a formatter reflow or a re-indentation preserves behaviour.
// The tool never installs it.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Two versions of one file; `name` is its file name, from which difftastic guesses the language. */
export type Versions = { name: string; before: string; after: string };

/** What `prepare` says when difftastic is missing; the tour carries on without the proof. */
export const difftasticHint =
  'difftastic is not on PATH, so no file can be proven syntax-identical (a reformat stays out of the mechanical tier). Tell the reviewer once that installing it gives that proof: `brew install difftastic` or `cargo install --locked difftastic`.';

let installed: boolean | undefined;

/** difftastic's `difft` runs from PATH. */
export function hasDifftastic(): boolean {
  installed ??= !spawnSync('difft', ['--version'], { stdio: 'ignore' }).error;
  return installed;
}

// difftastic reads its options from DFT_* variables too; the user's settings
// (ignoring comments, overriding languages, …) must not loosen the proof.
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('DFT_')));

/** For each pair, whether difftastic finds no syntactic change. Any other answer, failure included, proves nothing. */
export function sameSyntax(pairs: Versions[]): boolean[] {
  if (pairs.length === 0) return [];
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'review-tour-difft-'));
  try {
    const env = cleanEnv();
    return pairs.map(({ name, before, after }, index) => {
      // Each version keeps the file's name, in a folder of its own.
      const [oldFile, newFile] = ['old', 'new'].map((side, at) => {
        const file = path.join(scratch, String(index), side, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, at === 0 ? before : after, 'latin1');
        return file;
      });
      // --exit-code: exit 1 on a syntactic change, or on any byte change where difftastic can't parse the language.
      return spawnSync('difft', ['--check-only', '--exit-code', oldFile, newFile], { env, stdio: 'ignore' }).status === 0;
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
