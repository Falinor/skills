import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { item, makeStandUpSandbox, plan, started, writePlan, type StandUpSandbox } from '../../support/stand-up.ts';

let sandbox: StandUpSandbox;
let pageUrl: string;

// At the default 1280px width the grid holds three cards per row:
// yesterday is one two three / four, today is five six seven.
test.beforeAll(() => {
  sandbox = makeStandUpSandbox('2026-11-19');
  const folder = started(sandbox);
  const todo = { status: { label: 'To do', tone: 'todo' } };
  writePlan(
    folder,
    plan({
      yesterday: [{ title: 'Merged', items: ['one', 'two', 'three', 'four'].map((id) => item(id)) }],
      today: [{ title: 'Planned', items: ['five', 'six', 'seven'].map((id) => item(id, todo)) }],
      blockers: [{ title: 'Decisions', items: [item('eight')] }],
    }),
  );
  const result = sandbox.run(['render', folder]);
  expect(result.status, result.stderr).toBe(0);
  pageUrl = pathToFileURL(path.join(folder, 'stand-up.html')).href;
});

test.afterAll(() => sandbox.cleanup());

const link = (page: Page, id: string) => page.getByRole('link', { name: `Title ${id}`, exact: true });

test('arrow keys move between cards: left and right in page order, up and down by row', async ({ page }) => {
  await page.goto(pageUrl);
  await link(page, 'one').focus();

  await page.keyboard.press('ArrowRight');
  await expect(link(page, 'two')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(link(page, 'one')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(link(page, 'four')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(link(page, 'five')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(link(page, 'four')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(link(page, 'five')).toBeFocused();
});

test('arrow keys leave the page alone while no card has focus', async ({ page }) => {
  await page.goto(pageUrl);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');

  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
});

test('the footer names the keyboard shortcuts', async ({ page }) => {
  await page.goto(pageUrl);

  await expect(page.getByRole('contentinfo')).toContainText('← →');
});

const entering = (page: Page, id: string) =>
  page.locator(`.detail[data-id="${id}"]`).evaluate((panel) => ({
    direction: (panel as HTMLElement).dataset.enter ?? '',
    animation: getComputedStyle(panel).animationName,
  }));

test('in the details, left and right arrows walk the items, sliding in from that side', async ({ page }) => {
  await page.goto(`${pageUrl}#two`);
  await expect(page.getByRole('dialog', { name: 'Title two' })).toBeVisible();
  expect((await entering(page, 'two')).direction).toBe('');

  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: 'Title three' })).toBeVisible();
  expect(await entering(page, 'three')).toEqual({ direction: 'next', animation: 'enter-next' });

  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: 'Title two' })).toBeVisible();
  expect(await entering(page, 'two')).toEqual({ direction: 'previous', animation: 'enter-previous' });
});

test('with reduced motion, items change without sliding', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${pageUrl}#two`);

  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('dialog', { name: 'Title three' })).toBeVisible();
  expect((await entering(page, 'three')).animation).toBe('none');
});

test("only today's items have a Done checkbox", async ({ page }) => {
  await page.goto(pageUrl);

  await expect(page.getByRole('checkbox')).toHaveCount(3);
  await expect(page.getByRole('checkbox', { name: 'Done – Title five' })).toBeVisible();
});

test('ticking an item done marks its card and its details, and survives a reload', async ({ page }) => {
  await page.goto(pageUrl);
  const box = page.getByRole('checkbox', { name: 'Done – Title five' });
  await expect(page.locator('#section-today').locator('..')).toContainText('0 / 3 done');

  await box.check();

  const card = page.locator('#card-five');
  await expect(card).toHaveClass(/\bdone\b/);
  await expect(card.locator('.pill')).toHaveText('Done');
  await expect(page.locator('#section-today').locator('..')).toContainText('1 / 3 done');
  await link(page, 'five').click();
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: 'Done – Title five' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect.poll(() => new URL(page.url()).hash).toBe('');

  await page.reload();
  await expect(box).toBeChecked();
  await expect(card.locator('.pill')).toHaveText('Done');

  await box.uncheck();
  await expect(card).not.toHaveClass(/\bdone\b/);
  await expect(card.locator('.pill')).toHaveText('To do');
});

test('ticking still works when the browser blocks storage', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
  });
  await page.goto(pageUrl);

  await page.getByRole('checkbox', { name: 'Done – Title six' }).check();

  await expect(page.locator('#card-six')).toHaveClass(/\bdone\b/);
  expect(errors).toEqual([]);
});
