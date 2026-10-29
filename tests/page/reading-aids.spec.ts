import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';
import { prepareChange, writePlan } from '../support/tour.ts';

let sandbox: Sandbox;
let pageUrl: string;

test.beforeAll(() => {
  sandbox = makeSandbox();
  const { folder, repo } = prepareChange(sandbox, {
    trunk: { 'a.txt': 'one\ntwo\nthree\n' },
    feature: { 'a.txt': 'one\nTWO\nthree\nfour\n' },
  });
  writePlan(folder, {
    steps: [
      {
        title: 'A',
        files: ['a.txt'],
        explanation: 'Upper-cases two.',
        callouts: [
          { file: 'a.txt', line: 2, side: 'old', tag: 'Breaking', text: 'Lower case is gone.' },
          { file: 'a.txt', line: 4, side: 'new', tag: 'Subtle', text: 'Four is new.' },
        ],
      },
    ],
  });
  const result = sandbox.run(['render', folder], { cwd: repo.dir });
  expect(result.status, result.stderr).toBe(0);
  pageUrl = pathToFileURL(path.join(folder, 'tour.html')).href;
});

test.afterAll(() => sandbox.cleanup());

test('each callout shows right under the line it is anchored to', async ({ page }) => {
  await page.goto(pageUrl);

  const rowAfter = (code: string) =>
    page.getByRole('row').filter({ hasText: code }).locator('xpath=following-sibling::tr[1]');
  await expect(rowAfter('-two')).toHaveText('BreakingLower case is gone.');
  await expect(rowAfter('+four')).toHaveText('SubtleFour is new.');
  await expect(rowAfter('+four')).toBeVisible();
});
