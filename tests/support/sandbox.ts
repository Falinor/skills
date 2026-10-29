// Throwaway world for driving the review-tour CLI from the outside:
// a temp root holding git repositories, a private TMPDIR (where work
// folders land) and a bin/ directory for fake executables.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CLI = path.join(
  import.meta.dirname,
  '../../skills/review-tour/scripts/review-tour.mjs',
);

export type RunResult = { status: number | null; stdout: string; stderr: string };

export type Repo = {
  dir: string;
  git: (...args: string[]) => string;
  /** Write files (string content) or delete them (null), relative to the repo. */
  write: (files: Record<string, string | null>) => void;
  /** Stage everything and commit; returns the new commit id. */
  commit: (message: string) => string;
};

export type Sandbox = {
  root: string;
  /** TMPDIR seen by the CLI: work folders are created under it. */
  tmp: string;
  /** Directory prepended to PATH for the CLI. */
  bin: string;
  env: NodeJS.ProcessEnv;
  /** A fresh repository whose first branch is `trunk` (never `main`). */
  repo: (name?: string) => Repo;
  /** A bare repository plus a clone of it; the clone has `origin/HEAD` set. */
  cloned: (seed: Record<string, string>, defaultBranch?: string) => { origin: Repo; clone: Repo };
  /** Run the CLI with the sandbox environment. */
  run: (args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; nodeArgs?: string[] }) => RunResult;
  /** Put an executable on the CLI's PATH that logs its arguments, one JSON array per line, to `<bin>/<name>.log`. */
  fake: (name: string, body?: string) => { log: () => string[][] };
  cleanup: () => void;
};

export function makeSandbox(): Sandbox {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rt-test-')));
  const tmp = path.join(root, 'tmp');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(tmp);
  fs.mkdirSync(bin);
  const gitConfig = path.join(root, 'gitconfig');
  fs.writeFileSync(gitConfig, '');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TMPDIR: tmp,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
  };

  const openRepo = (dir: string): Repo => {
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
      return result.stdout.trim();
    };
    return {
      dir,
      git,
      write(files) {
        for (const [file, content] of Object.entries(files)) {
          const target = path.join(dir, file);
          if (content === null) {
            fs.rmSync(target);
          } else {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content);
          }
        }
      },
      commit(message) {
        git('add', '-A');
        git('commit', '-q', '--allow-empty', '-m', message);
        return git('rev-parse', 'HEAD');
      },
    };
  };

  const repo = (name = 'project') => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    const created = openRepo(dir);
    created.git('init', '-q', '-b', 'trunk');
    return created;
  };

  return {
    root,
    tmp,
    bin,
    env,
    repo,
    cloned(seed, defaultBranch = 'trunk') {
      const source = repo('seed');
      source.git('symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`);
      source.write(seed);
      source.commit('seed');
      const originDir = path.join(root, 'origin.git');
      source.git('clone', '-q', '--bare', source.dir, originDir);
      const cloneDir = path.join(root, 'project');
      source.git('clone', '-q', originDir, cloneDir);
      return { origin: openRepo(originDir), clone: openRepo(cloneDir) };
    },
    run(args, { cwd, env: extra, nodeArgs = [] }) {
      const result = spawnSync(process.execPath, [...nodeArgs, CLI, ...args], {
        cwd,
        env: { ...env, ...extra },
        encoding: 'utf8',
      });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    },
    fake(name, body = '') {
      const logFile = path.join(bin, `${name}.log`);
      const file = path.join(bin, name);
      fs.writeFileSync(
        file,
        `#!${process.execPath}\n` +
          `require('node:fs').appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n` +
          body,
      );
      fs.chmodSync(file, 0o755);
      return {
        log: () =>
          fs.existsSync(logFile)
            ? fs.readFileSync(logFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[])
            : [],
      };
    },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
