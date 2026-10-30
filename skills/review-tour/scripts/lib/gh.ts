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

/**
 * Runs a GraphQL query or mutation on `host` through gh and returns its
 * `data`. Strings go as raw variables (never parsed by gh), numbers typed.
 */
export function graphql<T>(host: string, query: string, variables: Record<string, string | number>): T {
  const fields = Object.entries(variables).flatMap(([key, value]) =>
    typeof value === 'number' ? ['-F', `${key}=${value}`] : ['-f', `${key}=${value}`],
  );
  const output = gh(process.cwd(), ['api', 'graphql', '--hostname', host, '-f', `query=${query}`, ...fields]);
  return (JSON.parse(output) as { data: T }).data;
}
