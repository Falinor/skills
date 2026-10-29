// Runs the command-line tools the skill drives (git, gh) and captures what
// they print.
import { spawnSync } from 'node:child_process';
import { UserError } from './errors.ts';

/** A whole change's patch passes through stdout. */
const maxBuffer = 1024 ** 3;

export type SpawnOptions = { cwd: string; env?: NodeJS.ProcessEnv; input?: string };

export type RunResult = { status: number | null; stdout: string; stderr: string };

function spawn(command: string, args: string[], { cwd, env, input }: SpawnOptions) {
  const result = spawnSync(command, args, { cwd, env, input, maxBuffer });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr.toString() };
}

/** Stops the tool with the command's own message unless it succeeded. */
function succeeded<T extends { status: number | null; stderr: string }>(command: string, args: string[], result: T): T {
  if (result.status !== 0) throw new UserError(`${command} ${args.join(' ')} failed:\n${result.stderr.trim()}`);
  return result;
}

/** Runs `command` without throwing when it fails; for commands whose failure is an answer. */
export function tryRun(command: string, args: string[], options: SpawnOptions): RunResult {
  const result = spawn(command, args, options);
  return { ...result, stdout: result.stdout.toString() };
}

/** Runs `command` and returns its stdout; a failure stops the tool with the command's message. */
export function run(command: string, args: string[], options: SpawnOptions): string {
  return succeeded(command, args, tryRun(command, args, options)).stdout;
}

/** Like `run`, with stdout as bytes, for output that is not text. */
export function runBytes(command: string, args: string[], options: SpawnOptions): Buffer {
  return succeeded(command, args, spawn(command, args, options)).stdout;
}
