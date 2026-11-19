import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCommandArgs } from './args.ts';
import { handover } from './handover.ts';
import { renderPage } from './page.ts';
import { readPlan, validatePlan } from './plan.ts';
import { sectionsOf } from './sections.ts';
import { readContext, workFolderFiles } from './work-folder.ts';

const usage = 'usage: stand-up render <work-folder> [--open]';

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

/** Validates the plan in the work folder and writes the page beside it. */
export function render(args: string[]): void {
  const { values, positionals } = parseCommandArgs(args, { open: { type: 'boolean', default: false } }, usage, 1);
  const folder = path.resolve(positionals[0]);

  const context = readContext(folder);
  const { plan, labels } = validatePlan(readPlan(folder), context.lang);
  const sections = sectionsOf(plan, labels, context);
  const page = path.join(folder, workFolderFiles.page);
  fs.writeFileSync(page, renderPage(sections, labels, context));

  const url = pathToFileURL(page).href;
  console.log(`Page: ${page}\nOpen: ${url}\n\n${handover(sections, labels, url)}`);
  // Headless runs set STAND_UP_NO_OPEN so no run opens a browser tab.
  if (values.open && !process.env.STAND_UP_NO_OPEN) openPage(page);
}
