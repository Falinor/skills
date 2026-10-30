import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';
import { prepareChange, writePlan } from '../support/tour.ts';

let sandbox: Sandbox;
let pageUrl: string;

const lines = (prefix: string) => Array.from({ length: 80 }, (_, index) => `${prefix} ${index}`).join('\n');

const wiring = [
  '// Registers the check before any session starts.',
  'import { register } from "./registry";',
  'export class Wiring extends Base {',
  '  @inject() async start(token: Token): Promise<void> {',
  '    register(checkToken, { retries: 3, strict: true, pattern: /^t-/ });',
  '  }',
  '}',
  '',
].join('\n');

const titles = ['Check tokens', 'Expire sessions', 'Register the check', 'Rename the helper'];

test.beforeAll(() => {
  sandbox = makeSandbox();
  const { folder, repo } = prepareChange(
    sandbox,
    {
      trunk: { 'helper.txt': 'help\n', 'wiring.ts': 'register(checkToken, 1);\n' },
      // Highlighted code, so the readability checks cover every token colour on added and removed lines.
      feature: { 'tokens.txt': lines('token'), 'sessions.txt': lines('session'), 'wiring.ts': wiring },
    },
    { 'helper.txt': 'helpers.txt' },
  );
  writePlan(folder, {
    intent: {
      why: 'Expired tokens start sessions; see [the issue](https://example.invalid/1).',
      visual: 'startSession(token)\n  checkToken(token)',
      mergeDanger: { door: 'one-way', blastRadius: '`sign-in`' },
    },
    steps: [
      {
        title: titles[0],
        tier: 'core-logic',
        files: ['tokens.txt'],
        explanation: 'Checks **tokens** with `check`.',
        questions: ['Is a day the right expiry?'],
        pseudocode: 'if expired(token): reject',
        trace: { input: '`token` from yesterday', old: ['accepted'], new: ['rejected'] },
        callouts: [{ file: 'tokens.txt', line: 2, side: 'new', tag: 'Subtle', text: 'Off by one.' }],
      },
      {
        title: titles[1],
        tier: 'core-logic',
        files: ['sessions.txt'],
        explanation: 'Expires sessions.',
        unprovenMechanical: ['sessions.txt'],
      },
      { title: titles[2], tier: 'wiring', files: ['wiring.ts'], explanation: 'Registers the check.' },
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

/**
 * Every visible text whose contrast with the background behind it is below
 * WCAG AA (4.5:1), and the luminance of the page background.
 */
function readability(page: Page) {
  return page.evaluate(() => {
    const channels = (color: string) => (color.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = (color: string) => {
      const [r, g, b] = channels(color).map((value) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const backgroundOf = (element: Element | null): string => {
      for (; element; element = element.parentElement) {
        const color = getComputedStyle(element).backgroundColor;
        if ((channels(color)[3] ?? 1) > 0) return color;
      }
      return 'rgb(255, 255, 255)';
    };
    const unreadable = [...document.querySelectorAll('body *')].flatMap((element) => {
      const text = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join('').trim();
      if (text === '' || element.getClientRects().length === 0) return [];
      const [a, b] = [luminance(getComputedStyle(element).color), luminance(backgroundOf(element))];
      const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      return contrast < 4.5 ? [`${element.tagName.toLowerCase()}.${element.className} "${text.slice(0, 20)}" ${contrast.toFixed(2)}`] : [];
    });
    return { unreadable, background: luminance(backgroundOf(document.body)) };
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`with a ${scheme} system theme`, () => {
    test.use({ colorScheme: scheme });

    test(`the page follows it and every text stays readable`, async ({ page }) => {
      await page.goto(pageUrl);

      const { unreadable, background } = await readability(page);
      expect(unreadable).toEqual([]);
      if (scheme === 'dark') expect(background).toBeLessThan(0.05);
      else expect(background).toBeGreaterThan(0.9);
      await expect(page.getByRole('button', { name: 'Dark theme' })).toHaveAttribute('aria-pressed', String(scheme === 'dark'));
    });

    test('the theme switch turns to the other theme, every text still readable', async ({ page }) => {
      await page.goto(pageUrl);
      const themeSwitch = page.getByRole('button', { name: 'Dark theme' });

      await themeSwitch.click();

      const { unreadable, background } = await readability(page);
      expect(unreadable).toEqual([]);
      if (scheme === 'dark') expect(background).toBeGreaterThan(0.9);
      else expect(background).toBeLessThan(0.05);
      await expect(themeSwitch).toHaveAttribute('aria-pressed', String(scheme !== 'dark'));
    });
  });
}

test('the page runs only its own script, allowed by hash', async ({ page }) => {
  await page.goto(pageUrl);

  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  const scriptSources = policy?.split(';').map((directive) => directive.trim().split(/\s+/)).find(([name]) => name === 'script-src');
  expect(scriptSources).toEqual(['script-src', expect.stringMatching(/^'sha256-[A-Za-z0-9+/]+=*'$/)]);
  await expect(page.locator('script')).toHaveCount(1);
});
