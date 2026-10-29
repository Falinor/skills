import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';
import { prepareChange, writePlan } from '../support/tour.ts';

let sandbox: Sandbox;
let pageUrl: string;

const lines = Array.from({ length: 120 }, (_, index) => `line ${index}`).join('\n');

test.beforeAll(() => {
  sandbox = makeSandbox();
  const { folder, repo } = prepareChange(sandbox, { trunk: {}, feature: { 'a.txt': lines } });
  writePlan(folder, {
    intent: {
      why: 'Expired tokens start sessions.\nCheck them first.',
      visual: 'startSession(token)\n  validateToken(token)',
      mergeDanger: { door: 'one-way', blastRadius: 'sign-in' },
    },
    steps: [{ title: 'Check tokens', files: ['a.txt'], explanation: 'The check.' }],
  });
  const result = sandbox.run(['render', folder], { cwd: repo.dir });
  expect(result.status, result.stderr).toBe(0);
  pageUrl = pathToFileURL(path.join(folder, 'tour.html')).href;
});

test.afterAll(() => sandbox.cleanup());

test('the page opens on the intent, before the first step', async ({ page }) => {
  await page.goto(pageUrl);

  const intent = page.getByRole('region', { name: 'Intent' });
  await expect(intent).toBeInViewport();
  await expect(intent).toContainText('Expired tokens start sessions.');
  await expect(intent).toContainText('One-way door, blast radius: sign-in');
  const intentBox = await intent.boundingBox();
  const stepBox = await page.locator('#step-1').boundingBox();
  expect(intentBox!.y).toBeLessThan(stepBox!.y);
});

test('the intent visual keeps its lines and indentation', async ({ page }) => {
  await page.goto(pageUrl);

  expect(await page.locator('#intent pre').innerText()).toBe(
    'startSession(token)\n  validateToken(token)',
  );
});
