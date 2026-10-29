// A fake GitHub for tests: a `gh` on PATH with canned answers, and a
// repository whose pull request only exists on its remote.
import type { Repo, Sandbox } from './sandbox.ts';

export type GhAnswer = {
  /** The call's first arguments, e.g. ['pr', 'view']. */
  args: string[];
  /** Text the call's arguments must contain, e.g. a GraphQL mutation name. */
  includes?: string;
  /** Printed on stdout; non-strings as JSON. */
  stdout?: unknown;
  stderr?: string;
  status?: number;
};

/**
 * Puts a fake `gh` on PATH. Each call gets the first answer whose `args`
 * start the call and whose `includes` it contains; any other call fails
 * loudly. `log()` lists every call's arguments, `--version` probes included.
 */
export function fakeGh(sandbox: Sandbox, answers: GhAnswer[]) {
  return sandbox.fake(
    'gh',
    `const answers = ${JSON.stringify(answers)};
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('gh version 0.0.0 (fake)'); process.exit(0); }
const answer = answers.find((a) =>
  a.args.every((arg, i) => args[i] === arg) && (a.includes === undefined || args.join(' ').includes(a.includes)));
if (!answer) { console.error('fake gh: unexpected call ' + JSON.stringify(args)); process.exit(1); }
if (answer.stdout !== undefined) {
  process.stdout.write(typeof answer.stdout === 'string' ? answer.stdout : JSON.stringify(answer.stdout));
}
if (answer.stderr) process.stderr.write(answer.stderr);
process.exit(answer.status ?? 0);
`,
  );
}

export const pullRequestUrl = 'https://github.com/acme/project/pull/7';

/** What `gh pr view --json …` answers about a pull request. */
export type PullRequestView = {
  number: number;
  url: string;
  title: string;
  body: string;
  baseRefName: string;
  baseRefOid: string;
  headRefOid: string;
};

/**
 * A clone of acme/project (`origin` is `git@github.com:acme/project.git`,
 * rewritten to a local bare repository; other GitHub URLs reach nothing) and an `author` repository on a
 * `feature` branch cut from trunk. `publish()` pushes the author's HEAD as
 * pull request #7, which only the remote holds.
 */
export function pullRequestRepo(sandbox: Sandbox, trunk: Record<string, string>) {
  const { origin, clone } = sandbox.cloned(trunk);
  // Keep tests offline: any other GitHub URL leads nowhere.
  clone.git('config', '--global', `url.${sandbox.root}/offline/.insteadOf`, 'https://github.com/');
  clone.git('remote', 'set-url', 'origin', 'git@github.com:acme/project.git');
  clone.git('config', '--global', `url.${origin.dir}.insteadOf`, 'git@github.com:acme/project.git');
  const author: Repo = sandbox.repo('author');
  author.git('fetch', '-q', origin.dir, 'trunk');
  author.git('checkout', '-q', '-b', 'feature', 'FETCH_HEAD');
  return {
    origin,
    clone,
    author,
    /** Pushes the author's HEAD to `branch` on the remote. */
    push(branch: string) {
      author.git('push', '-q', '-f', origin.dir, `HEAD:refs/heads/${branch}`);
    },
    publish(base = 'trunk', view: Partial<PullRequestView> = {}): PullRequestView {
      author.git('push', '-q', '-f', origin.dir, 'HEAD:refs/pull/7/head');
      return {
        number: 7,
        url: pullRequestUrl,
        title: 'Add a feature',
        body: 'Adds a feature.',
        baseRefName: base,
        baseRefOid: origin.git('rev-parse', base),
        headRefOid: author.git('rev-parse', 'HEAD'),
        ...view,
      };
    },
  };
}
