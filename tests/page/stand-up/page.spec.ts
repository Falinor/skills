import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { item, makeStandUpSandbox, plan, started, writePlan, type StandUpSandbox } from '../../support/stand-up.ts';

let sandbox: StandUpSandbox;
let pageUrl: string;

test.beforeAll(() => {
  sandbox = makeStandUpSandbox('2026-11-19');
  const folder = started(sandbox);
  writePlan(
    folder,
    plan({
      yesterday: [{ title: 'Merged', items: [item('one'), item('two')] }],
      today: [{ title: 'Planned', items: [item('three')] }],
      blockers: [],
    }),
  );
  const result = sandbox.run(['render', folder]);
  expect(result.status, result.stderr).toBe(0);
  pageUrl = pathToFileURL(path.join(folder, 'stand-up.html')).href;
});

test.afterAll(() => sandbox.cleanup());

test('shows the three sections with their cards, and no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(pageUrl);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thursday, November 19, 2026');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Yesterday', 'Today', 'Blockers']);
  await expect(page.getByRole('link', { name: 'Title one' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Title three' })).toBeVisible();
  await expect(page.getByText('Nothing to report')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a card opens its details, and closing returns to the card', async ({ page }) => {
  await page.goto(pageUrl);

  await page.getByRole('link', { name: 'Title two' }).click();

  const dialog = page.getByRole('dialog', { name: 'Title two' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('What two changes for users.')).toBeVisible();
  await expect(dialog.getByText('Technical detail of two.')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'PR #1' })).toHaveAttribute('href', 'https://github.com/acme/app/pull/1');
  expect(new URL(page.url()).hash).toBe('#two');

  await dialog.getByRole('button', { name: 'Close' }).click();

  await expect(dialog).toBeHidden();
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  await expect(page.getByRole('link', { name: 'Title two' })).toBeFocused();
});

test('#id opens that item, and Previous / Next walk every item in order', async ({ page }) => {
  await page.goto(`${pageUrl}#one`);

  await expect(page.getByRole('dialog', { name: 'Title one' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'Title two' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'Title three' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  expect(new URL(page.url()).hash).toBe('#three');

  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page.getByRole('dialog', { name: 'Title two' })).toBeVisible();
});

test('Escape closes the details', async ({ page }) => {
  await page.goto(`${pageUrl}#three`);
  await expect(page.getByRole('dialog', { name: 'Title three' })).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog')).toBeHidden();
});
