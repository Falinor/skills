// When the user last worked, read from what they did rather than from the
// calendar: their GitHub events (pushes, pull requests, reviews, comments, in
// every repository; GitHub keeps 90 days of them, 300 at most) and their own
// commits in the current repository, pushed or not.
import { spawnSync } from 'node:child_process';
import { localDay } from './dates.ts';
import { UserError } from './errors.ts';

function run(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : null;
}

const days = (output: string) =>
  output
    .split('\n')
    .map((line) => localDay(line.trim()))
    .filter((day): day is string => day !== null);

function githubDays(): string[] {
  const login = run('gh', ['api', 'user', '--jq', '.login'])?.trim();
  if (!login) throw new UserError('could not read your GitHub login through gh: check `gh auth status`, or pass --since');
  const events = run('gh', ['api', `users/${login}/events?per_page=100`, '--paginate', '--jq', '.[].created_at']);
  if (events === null) throw new UserError('could not read your GitHub activity through gh: pass --since to set the period by hand');
  return days(events);
}

function commitDays(today: string): string[] {
  const email = run('git', ['config', 'user.email'])?.trim();
  if (!email) return [];
  const log = run('git', ['log', '--all', '--fixed-strings', `--author=${email}`, `--before=${today}T00:00:00`, '--format=%aI', '-n', '100']);
  return log === null ? [] : days(log);
}

/** The latest day before `today` (YYYY-MM-DD) with any of the user's activity, or null. */
export function lastActiveDay(today: string): string | null {
  const before = [...githubDays(), ...commitDays(today)].filter((day) => day < today);
  return before.length ? before.reduce((latest, day) => (day > latest ? day : latest)) : null;
}
