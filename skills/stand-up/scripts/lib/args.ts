import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { UserError } from './errors.ts';

/** Parses a subcommand's arguments; any mistake stops with the usage line. */
export function parseCommandArgs<T extends ParseArgsOptionsConfig>(
  args: string[],
  options: T,
  usage: string,
  positionalCount: number,
) {
  try {
    const parsed = parseArgs({ args, options, allowPositionals: true, strict: true });
    if (parsed.positionals.length !== positionalCount) throw new UserError(usage);
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (code.startsWith('ERR_PARSE_ARGS')) throw new UserError(`${(error as Error).message}\n${usage}`);
    throw error;
  }
}
