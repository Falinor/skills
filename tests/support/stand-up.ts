// Throwaway world for driving the stand-up CLI from the outside: a temp root
// whose private TMPDIR receives the work folders, a fixed "today" in UTC, and
// a fake gh in place of the real one, answering with the activity a test
// gives it, so no test depends on the machine's login or history.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const STAND_UP_CLI = path.join(import.meta.dirname, '../../skills/stand-up/scripts/stand-up.mjs');

export type RunResult = { status: number | null; stdout: string; stderr: string };

export type StandUpSandbox = {
  root: string;
  /** TMPDIR seen by the CLI: work folders are created under it. */
  tmp: string;
  /** Run the CLI with the sandbox environment. */
  run: (args: string[], env?: NodeJS.ProcessEnv) => RunResult;
  /** Commit in a repository at the sandbox root, as the user, at `date` (ISO 8601). */
  commitAt: (date: string) => void;
  cleanup: () => void;
};

/** What the CLI finds on PATH for gh: a logged-in fake, a logged-out fake, or nothing. */
export type GhState = 'logged-in' | 'logged-out' | 'missing';

// The fake answers what the CLI asks: the login, then the user's events
// (one created_at per line, from bin/events.txt), as `gh api … --jq` prints them.
const fakeGh = (loggedIn: boolean) => `#!/bin/sh
case "$1 $2" in
  "auth status") exit ${loggedIn ? 0 : 1} ;;
  "api user") echo octocat ;;
  api\\ users/octocat/events*) cat "$(dirname "$0")/events.txt" ;;
esac
exit 0
`;

/** The full path of `tool` on the test runner's own PATH. */
function onPath(tool: string): string {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(dir, tool);
    if (dir && fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`${tool} is not on PATH`);
}

/** A sandbox whose CLI believes today is `today` (YYYY-MM-DD). */
export function makeStandUpSandbox(
  today = '2026-11-19',
  { gh = 'logged-in', events = [] }: { gh?: GhState; events?: string[] } = {},
): StandUpSandbox {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'su-test-')));
  const tmp = path.join(root, 'tmp');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(tmp);
  fs.mkdirSync(bin);
  // The fake gh comes first on PATH and shadows the real one. Without gh, PATH
  // holds only bin/, where git is linked so the CLI still finds it.
  let searchPath = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
  if (gh === 'missing') {
    fs.symlinkSync(onPath('git'), path.join(bin, 'git'));
    searchPath = bin;
  } else {
    fs.writeFileSync(path.join(bin, 'gh'), fakeGh(gh === 'logged-in'), { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'events.txt'), events.map((event) => `${event}\n`).join(''));
  }
  const gitConfig = path.join(root, 'gitconfig');
  fs.writeFileSync(gitConfig, '[user]\n\tname = Octo Cat\n\temail = octocat@example.invalid\n');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: searchPath,
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    STAND_UP_TODAY: today,
    STAND_UP_NO_OPEN: '1',
    TZ: 'UTC',
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const git = (args: string[], extra: NodeJS.ProcessEnv = {}) => {
    const result = spawnSync('git', args, { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
  };
  return {
    root,
    tmp,
    run: (args, extra = {}) => {
      const result = spawnSync(process.execPath, [STAND_UP_CLI, ...args], {
        cwd: root,
        env: { ...env, ...extra },
        encoding: 'utf8',
      });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    },
    commitAt: (date) => {
      if (!fs.existsSync(path.join(root, '.git'))) git(['init', '-q']);
      git(['commit', '-q', '--allow-empty', '-m', `work on ${date}`], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** The work folder `start` creates for `date`. */
export function workFolder(sandbox: StandUpSandbox, date: string): string {
  return path.join(sandbox.tmp, 'stand-up', date);
}

/** Runs `start` and returns its work folder. */
export function started(sandbox: StandUpSandbox, args: string[] = []): string {
  const result = sandbox.run(['start', ...args]);
  if (result.status !== 0) throw new Error(result.stderr);
  const line = result.stdout.split('\n').find((text) => text.startsWith('Work folder: '));
  if (!line) throw new Error(result.stdout);
  return line.slice('Work folder: '.length);
}

export function writePlan(folder: string, plan: unknown): void {
  fs.writeFileSync(path.join(folder, 'plan.json'), JSON.stringify(plan, null, 2));
}

export function readPage(folder: string): string {
  return fs.readFileSync(path.join(folder, 'stand-up.html'), 'utf8');
}

type Item = Record<string, unknown>;

/** A valid item; `extra` overrides any field. */
export function item(id: string, extra: Item = {}): Item {
  return {
    id,
    title: `Title ${id}`,
    summary: `Summary ${id}`,
    kind: 'server',
    status: { label: 'Merged', tone: 'ok' },
    refs: '#1',
    product: `What ${id} changes for users.`,
    tech: [`Technical detail of ${id}.`],
    links: [{ url: 'https://github.com/acme/app/pull/1', label: 'PR #1' }],
    ...extra,
  };
}

/** A valid plan with one item per section; `extra` overrides any field. */
export function plan(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    yesterday: [{ title: 'Merged', items: [item('one')] }],
    today: [{ title: 'Planned', items: [item('two', { status: { label: 'To do', tone: 'todo' } })] }],
    blockers: [{ title: 'Decisions', items: [item('three', { status: { label: 'Waiting', tone: 'warn' } })] }],
    ...extra,
  };
}
