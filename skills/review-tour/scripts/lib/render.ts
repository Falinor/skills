import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCommandArgs } from './args.ts';
import { UserError } from './errors.ts';
import { renderPage } from './page.ts';
import { cutPatch } from './patch.ts';
import { validatePlan } from './plan.ts';
import { readCapture, workFolderFiles } from './work-folder.ts';

const usage = 'usage: review-tour render <work-folder> [--open]';

const openers: Partial<Record<NodeJS.Platform, [string, ...string[]]>> = {
  darwin: ['open'],
  linux: ['xdg-open'],
  win32: ['cmd', '/c', 'start', ''],
};

/** Best effort: headless agents have no browser, and the page path is printed anyway. */
function openPage(page: string): void {
  const [command, ...args] = openers[process.platform] ?? ['xdg-open'];
  const result = spawnSync(command, [...args, page], { stdio: 'ignore' });
  if (result.error || result.status !== 0) console.log('Could not open a browser; open the page above by hand.');
}

function readPlan(folder: string): unknown {
  const file = path.join(folder, workFolderFiles.plan);
  if (!fs.existsSync(file)) throw new UserError(`no tour plan at ${file}; write it first.`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new UserError(`${workFolderFiles.plan} is not valid JSON: ${(error as Error).message}`);
  }
}

/** Validates the tour plan in the work folder and writes the page beside it. */
export function render(args: string[]): void {
  const { values, positionals } = parseCommandArgs(args, { open: { type: 'boolean', default: false } }, usage, 1);
  const folder = path.resolve(positionals[0]);

  const { change, patch } = readCapture(folder);
  const plan = validatePlan(readPlan(folder), change);
  const page = path.join(folder, workFolderFiles.page);
  fs.writeFileSync(page, renderPage(change, plan, cutPatch(patch, change.files)));

  console.log(`Page: ${page}\nOpen: ${pathToFileURL(page).href}`);
  if (values.open) openPage(page);
}
