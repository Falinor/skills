import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { payloads, renderHostileTour } from '../support/hostile.ts';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';

let sandbox: Sandbox;
let pageUrl: string;

test.beforeAll(() => {
  sandbox = makeSandbox();
  pageUrl = pathToFileURL(renderHostileTour(sandbox)).href;
});

test.afterAll(() => sandbox.cleanup());

test('hostile text in prose and diffs stays inert', async ({ page }) => {
  const seen = { dialogs: [] as string[], requests: [] as string[], errors: [] as string[] };
  page.on('dialog', (dialog) => {
    seen.dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  page.on('request', (request) => seen.requests.push(request.url()));
  page.on('pageerror', (error) => seen.errors.push(String(error)));

  await page.goto(pageUrl);
  await page.getByRole('link', { name: 'docs' }).hover();
  await page.waitForLoadState('load');

  expect(seen.dialogs).toEqual([]);
  expect(seen.requests).toEqual([pageUrl]);
  expect(seen.errors).toEqual([]);
  expect(await page.evaluate(() => (window as { __pwned?: unknown }).__pwned)).toBeUndefined();
  await expect(page.locator('img, svg, iframe, body style, body script')).toHaveCount(0);
  await expect(page.locator('a[href^="javascript:" i]')).toHaveCount(0);
  const handlers = await page.evaluate(() =>
    [...document.querySelectorAll('*')].flatMap((element) =>
      element.getAttributeNames().filter((name) => name.startsWith('on')),
    ),
  );
  expect(handlers).toEqual([]);
  for (const payload of payloads) await expect(page.getByText(payload).first()).toBeVisible();
});
