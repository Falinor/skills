import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';
import { prepareChange, writePlan } from '../support/tour.ts';

let sandbox: Sandbox;
let pageUrl: string;

const lines = (prefix: string) => Array.from({ length: 120 }, (_, index) => `${prefix} ${index}`).join('\n');

test.beforeAll(() => {
  sandbox = makeSandbox();
  const { folder, repo } = prepareChange(sandbox, {
    trunk: {},
    feature: { 'first.txt': lines('first'), 'second.txt': lines('second') },
  });
  writePlan(folder, {
    steps: [
      { title: 'First', tier: 'core-logic', files: ['first.txt'], explanation: 'The first file.' },
      { title: 'Second', tier: 'core-logic', files: ['second.txt'], explanation: 'The second file.' },
    ],
  });
  const result = sandbox.run(['render', folder], { cwd: repo.dir });
  expect(result.status, result.stderr).toBe(0);
  pageUrl = pathToFileURL(path.join(folder, 'tour.html')).href;
});

test.afterAll(() => sandbox.cleanup());

test('the page loads with every step', async ({ page }) => {
  await page.goto(pageUrl);

  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Intent', 'Step 1 · First', 'Step 2 · Second']);
});

test('#step-N lands on its step', async ({ page }) => {
  await page.goto(`${pageUrl}#step-2`);

  await expect(page.locator('#step-2')).toBeInViewport();
  await expect(page.getByRole('heading', { name: 'Step 1 · First' })).not.toBeInViewport();
});
