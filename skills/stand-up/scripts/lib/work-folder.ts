// The work folder: one per day under the system temp directory, holding what
// `start` decided (context.json), the agent's plan and the rendered page.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDay } from './dates.ts';
import { UserError } from './errors.ts';

export const workFolderFiles = { context: 'context.json', plan: 'plan.json', page: 'stand-up.html' } as const;

/** The period a stand-up reports on (since … until, the day before today) and the page's language. */
export type Context = { today: string; since: string; until: string; lang: string };

export function workFolderFor(today: string): string {
  return path.join(os.tmpdir(), 'stand-up', today);
}

export function writeContext(folder: string, context: Context): void {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, workFolderFiles.context), `${JSON.stringify(context, null, 2)}\n`);
}

export function readContext(folder: string): Context {
  const file = path.join(folder, workFolderFiles.context);
  if (!fs.existsSync(file)) throw new UserError(`${folder} is not a stand-up work folder: run start first`);
  const context = JSON.parse(fs.readFileSync(file, 'utf8')) as Context;
  if (![context.today, context.since, context.until].every((day) => parseDay(day)) || typeof context.lang !== 'string') {
    throw new UserError(`${file} is damaged: run start again`);
  }
  return context;
}
