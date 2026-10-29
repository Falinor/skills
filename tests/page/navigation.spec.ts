import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';
import { prepareChange, writePlan } from '../support/tour.ts';

let sandbox: Sandbox;
let pageUrl: string;

const lines = (prefix: string) => Array.from({ length: 80 }, (_, index) => `${prefix} ${index}`).join('\n');

const titles = ['Check tokens', 'Expire sessions', 'Register the check', 'Rename the helper'];

test.beforeAll(() => {
  sandbox = makeSandbox();
  const { folder, repo } = prepareChange(
    sandbox,
    {
      trunk: { 'helper.txt': 'help\n' },
      feature: { 'tokens.txt': lines('token'), 'sessions.txt': lines('session'), 'wiring.txt': 'register\n' },
    },
    { 'helper.txt': 'helpers.txt' },
  );
  writePlan(folder, {
    steps: [
      {
        title: titles[0],
        tier: 'core-logic',
        files: ['tokens.txt'],
        explanation: 'Checks tokens.',
        callouts: [{ file: 'tokens.txt', line: 2, side: 'new', tag: 'Subtle', text: 'Off by one.' }],
      },
      { title: titles[1], tier: 'core-logic', files: ['sessions.txt'], explanation: 'Expires sessions.' },
      { title: titles[2], tier: 'wiring', files: ['wiring.txt'], explanation: 'Registers the check.' },
      { title: titles[3], tier: 'mechanical', files: ['helpers.txt'], explanation: 'Renamed.' },
    ],
  });
  const result = sandbox.run(['render', folder], { cwd: repo.dir });
  expect(result.status, result.stderr).toBe(0);
  pageUrl = pathToFileURL(path.join(folder, 'tour.html')).href;
});

test.afterAll(() => sandbox.cleanup());

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Steps' });

/** The URL names step `n` and its heading sits at the top of the viewport. */
async function expectAtStep(page: Page, n: number) {
  await expect(page).toHaveURL(new RegExp(`#step-${n}$`));
  const title = page.locator(`#step-${n}-title`);
  await expect(title).toBeInViewport();
  await expect.poll(async () => (await title.boundingBox())?.y).toBeLessThan(80);
}

test('the sidebar lists the steps grouped by tier', async ({ page }) => {
  await page.goto(pageUrl);

  const tier = (name: string) => sidebar(page).getByRole('list', { name }).getByRole('link');
  await expect(tier('Core logic')).toHaveText(['1 Check tokens', '2 Expire sessions']);
  await expect(tier('Wiring')).toHaveText(['3 Register the check']);
  await expect(tier('Mechanical')).toHaveText(['4 Rename the helper']);
});

test("the sidebar shows the reader's progress through the steps", async ({ page }) => {
  await page.goto(pageUrl);
  const current = sidebar(page).locator('[aria-current="step"]');
  await expect(sidebar(page)).toContainText('0 of 4 steps');
  await expect(current).toHaveCount(0);

  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect(sidebar(page)).toContainText('2 of 4 steps');
  await expect(current).toHaveText(['2 Expire sessions']);

  await page.locator('#step-3').evaluate((step) => step.scrollIntoView());
  await expect(sidebar(page)).toContainText('3 of 4 steps');
  await expect(current).toHaveText(['3 Register the check']);
});

test('j and k move to the next and previous step, and the #step-N link follows', async ({ page }) => {
  await page.goto(pageUrl);

  for (const step of [1, 2, 3, 4, 4]) {
    await page.keyboard.press('j');
    await expectAtStep(page, step);
  }
  for (const step of [3, 2, 1, 1]) {
    await page.keyboard.press('k');
    await expectAtStep(page, step);
  }
});

test('j and k start from the step being read, wherever the reader scrolled', async ({ page }) => {
  await page.goto(`${pageUrl}#step-2`);
  await page.locator('#step-1').evaluate((step) => step.scrollIntoView());

  await page.keyboard.press('j');

  await expectAtStep(page, 2);
});

test('every step is reachable from the sidebar with Tab and Enter, with a visible focus', async ({ page }) => {
  for (const [index, title] of titles.entries()) {
    await page.goto(pageUrl);
    for (let tab = 0; tab <= index; tab++) await page.keyboard.press('Tab');

    const link = sidebar(page).getByRole('link', { name: `${index + 1} ${title}` });
    await expect(link).toBeFocused();
    await expect(link).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Enter');
    await expectAtStep(page, index + 1);
  }
});

test('the page runs only its own script, allowed by hash', async ({ page }) => {
  await page.goto(pageUrl);

  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  const scriptSources = policy?.split(';').map((directive) => directive.trim().split(/\s+/)).find(([name]) => name === 'script-src');
  expect(scriptSources).toEqual(['script-src', expect.stringMatching(/^'sha256-[A-Za-z0-9+/]+=*'$/)]);
  await expect(page.locator('script')).toHaveCount(1);
});
