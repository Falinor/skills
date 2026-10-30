import { run } from './spawn.ts';

/** Runs gh and returns its stdout; a failure stops the tool with gh's message. */
export function gh(cwd: string, args: string[]): string {
  return run('gh', args, { cwd, env: { ...process.env, GH_PROMPT_DISABLED: '1' } });
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
