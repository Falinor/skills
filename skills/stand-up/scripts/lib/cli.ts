import { UserError } from './errors.ts';
import { printLabels } from './labels.ts';
import { render } from './render.ts';
import { start } from './start.ts';

type Command = (args: string[]) => void | Promise<void>;

const commands: Record<string, Command> = { start, render, labels: printLabels };

const usage = 'usage: stand-up <start|render|labels> [arguments]';

/** Runs one subcommand and returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const [name = '', ...args] = argv;
  try {
    const command = commands[name];
    if (!command) throw new UserError(usage);
    await command(args);
    return 0;
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    console.error(`stand-up: ${error.message}`);
    return 1;
  }
}
