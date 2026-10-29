import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCommandArgs } from './args.ts';
import { handover } from './handover.ts';
import { mechanicalOffer } from './mechanical-batch.ts';
import { renderPage } from './page.ts';
import { readTour } from './tour.ts';
import { workFolderFiles } from './work-folder.ts';

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

/** Validates the tour plan in the work folder and writes the page beside it. */
export function render(args: string[]): void {
  const { values, positionals } = parseCommandArgs(args, { open: { type: 'boolean', default: false } }, usage, 1);
  const folder = path.resolve(positionals[0]);

  const { change, diffs, plan } = readTour(folder);
  const page = path.join(folder, workFolderFiles.page);
  fs.writeFileSync(page, renderPage(change, plan, diffs));

  const url = pathToFileURL(page).href;
  console.log(`Page: ${page}\nOpen: ${url}\n\n${handover(plan, url)}`);
  const offer = mechanicalOffer(plan, change);
  if (offer) console.log(`\n${offer}`);
  // Headless runs, such as the agent eval's, set REVIEW_TOUR_NO_OPEN so no run opens a browser tab.
  if (values.open && !process.env.REVIEW_TOUR_NO_OPEN) openPage(page);
}
