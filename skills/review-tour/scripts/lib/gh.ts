import { spawnSync } from 'node:child_process';
import { UserError } from './errors.ts';

/** Runs gh and returns its stdout; a failure stops the tool with gh's message. */
export function gh(cwd: string, args: string[]): string {
  const result = spawnSync('gh', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 ** 3,
    env: { ...process.env, GH_PROMPT_DISABLED: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new UserError(`gh ${args.join(' ')} failed:\n${result.stderr.trim()}`);
  }
  return result.stdout;
}
