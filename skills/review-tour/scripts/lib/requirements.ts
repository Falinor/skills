import { spawnSync } from 'node:child_process';
import { UserError } from './errors.ts';

// Node itself is checked by the plain-JS launcher, before any TypeScript loads.
const installHints = {
  git: 'Install it from https://git-scm.com/downloads.',
} as const;

export type Tool = keyof typeof installHints;

/** Stops with every missing tool and how to install it. */
export function requireTools(tools: readonly Tool[]): void {
  const missing = tools.filter((tool) => {
    const error = spawnSync(tool, ['--version'], { stdio: 'ignore' }).error as NodeJS.ErrnoException | undefined;
    return error?.code === 'ENOENT';
  });
  if (missing.length > 0) {
    throw new UserError(
      missing.map((tool) => `needs ${tool}, which is not on PATH. ${installHints[tool]}`).join('\n'),
    );
  }
}
