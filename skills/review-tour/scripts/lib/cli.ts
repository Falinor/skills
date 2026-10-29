import { UserError } from './errors.ts';
import { prepare } from './prepare.ts';
import { requireTools } from './requirements.ts';

type Command = (args: string[]) => void | Promise<void>;

const commands: Record<string, Command> = { prepare };

const usage = 'usage: review-tour <command> [arguments]';

/** Runs one subcommand and returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const [name = '', ...args] = argv;
  try {
    requireTools(['git']);
    const command = commands[name];
    if (!command) throw new UserError(usage);
    await command(args);
    return 0;
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    console.error(`review-tour: ${error.message}`);
    return 1;
  }
}
