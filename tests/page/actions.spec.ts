import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';
import { prepareChange, preparePullRequest, writePlan } from '../support/tour.ts';

let sandbox: Sandbox;
let localSandbox: Sandbox;
let pageUrl: string;
let localUrl: string;
let head: string;

const steps = [
  { title: 'Upper-case two', files: ['a.txt'], explanation: 'Upper-cases two.' },
  { title: 'Add b', files: ['b c.txt'], explanation: 'Adds b.' },
  { title: 'Add d', files: ['d.txt'], explanation: 'Adds d.' },
];

test.beforeAll(() => {
  sandbox = makeSandbox();
  const tour = preparePullRequest(sandbox, {
    trunk: { 'a.txt': 'one\ntwo\nthree\n' },
    feature: { 'a.txt': 'one\nTWO\nthree\n', 'b c.txt': 'b\n', 'd.txt': 'd\n' },
  });
  writePlan(tour.folder, { steps });
  const rendered = sandbox.run(['render', tour.folder], { cwd: tour.clone.dir });
  expect(rendered.status, rendered.stderr).toBe(0);
  pageUrl = pathToFileURL(path.join(tour.folder, 'tour.html')).href;
  head = tour.head;

  localSandbox = makeSandbox();
  const local = prepareChange(localSandbox, { trunk: { 'a.txt': 'one\n' }, feature: { 'a.txt': 'ONE\n' } });
  writePlan(local.folder, { steps: [{ title: 'A', files: ['a.txt'], explanation: 'A.' }] });
  const localRendered = localSandbox.run(['render', local.folder], { cwd: local.repo.dir });
  expect(localRendered.status, localRendered.stderr).toBe(0);
  localUrl = pathToFileURL(path.join(local.folder, 'tour.html')).href;
});

test.afterAll(() => {
  sandbox.cleanup();
  localSandbox.cleanup();
});

const block = (page: Page) => page.getByRole('textbox', { name: 'Actions to paste to your agent' });
const done = (page: Page, step: number) => page.locator(`#step-${step}`).getByRole('checkbox', { name: 'Done' });

test('ticked steps and line comments make one block to paste', async ({ page }) => {
  await page.goto(pageUrl);
  await expect(block(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Copy' })).toBeDisabled();

  await done(page, 1).check();
  await done(page, 2).check();
  await done(page, 3).check();
  await page.getByRole('button', { name: 'Comment on a.txt, new line 2' }).click();
  await page.keyboard.type('Why upper case?');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('j and k stay text here.');
  await page.getByRole('button', { name: 'Comment on a.txt, old line 2' }).click();
  await page.keyboard.type('Keep this one.');
  await page.getByRole('button', { name: 'Comment on b c.txt, new line 1' }).click();
  await page.keyboard.type('Odd name.');

  await expect(block(page)).toHaveValue(
    [
      `review-tour actions ${head}`,
      'done 1-3',
      'comment a.txt 2 new',
      '> Why upper case?',
      '>',
      '> j and k stay text here.',
      'comment a.txt 2 old',
      '> Keep this one.',
      'comment "b c.txt" 1 new',
      '> Odd name.',
    ].join('\n'),
  );
  await expect(page.locator('#actions-summary')).toHaveText('3 steps done, 3 comments.');
});

test('done steps go as ranges, and a removed or empty comment leaves the block', async ({ page }) => {
  await page.goto(pageUrl);

  await done(page, 3).check();
  await done(page, 1).check();
  await page.getByRole('button', { name: 'Comment on a.txt, new line 1' }).click();
  await page.keyboard.type('Gone soon.');
  await page.getByRole('button', { name: 'Comment on d.txt, new line 1' }).click();
  await page.getByRole('button', { name: 'Remove comment' }).first().click();

  await expect(block(page)).toHaveValue(`review-tour actions ${head}\ndone 1,3`);
});

test('Copy puts the block on the clipboard', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => void ((window as unknown as { copied: string }).copied = text) },
    });
  });
  await page.goto(pageUrl);
  await done(page, 2).check();

  await page.getByRole('button', { name: 'Copy' }).click();

  await expect(page.getByRole('status')).toHaveText('Copied: paste it into the chat with your agent.');
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(`review-tour actions ${head}\ndone 2`);
});

test('without the clipboard, Copy selects the block instead', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => Promise.reject(new Error('denied')) } });
  });
  await page.goto(pageUrl);
  await done(page, 2).check();

  await page.getByRole('button', { name: 'Copy' }).click();

  await expect(page.getByRole('status')).toHaveText('Selected: copy it, then paste it into the chat with your agent.');
  await expect(block(page)).toBeFocused();
  expect(await block(page).evaluate((area: HTMLTextAreaElement) => area.value.slice(area.selectionStart, area.selectionEnd))).toBe(
    `review-tour actions ${head}\ndone 2`,
  );
});

test('a reload keeps the ticks and the comments, until Clear', async ({ page }) => {
  await page.goto(pageUrl);
  await done(page, 2).check();
  await page.getByRole('button', { name: 'Comment on d.txt, new line 1' }).click();
  await page.keyboard.type('Still here.');

  await page.reload();

  await expect(done(page, 2)).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Comment on new line 1' })).toHaveValue('Still here.');
  await expect(block(page)).toHaveValue(`review-tour actions ${head}\ndone 2\ncomment d.txt 1 new\n> Still here.`);

  await page.getByRole('button', { name: 'Clear' }).click();
  await page.reload();

  await expect(done(page, 2)).not.toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Comment on new line 1' })).toHaveCount(0);
  await expect(block(page)).toBeHidden();
});

test('a local-branch tour has nothing to tick or comment', async ({ page }) => {
  await page.goto(localUrl);

  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('.line-comment')).toHaveCount(0);
  await expect(page.locator('#actions')).toHaveCount(0);
});
