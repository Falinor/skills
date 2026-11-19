import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  item,
  makeStandUpSandbox,
  plan,
  readPage,
  started,
  writePlan,
  type StandUpSandbox,
} from '../../support/stand-up.ts';

let sandbox: StandUpSandbox;
beforeEach(() => {
  sandbox = makeStandUpSandbox('2026-11-19');
});
afterEach(() => sandbox.cleanup());

test('writes the page, prints its link and lists every item by #id', () => {
  const folder = started(sandbox);
  writePlan(folder, plan());

  const result = sandbox.run(['render', folder]);

  assert.equal(result.status, 0, result.stderr);
  const page = path.join(folder, 'stand-up.html');
  const url = pathToFileURL(page).href;
  assert.ok(result.stdout.includes(`Page: ${page}`), result.stdout);
  assert.ok(result.stdout.includes(`${url}#one`), result.stdout);
  assert.ok(result.stdout.includes(`${url}#two`), result.stdout);
  assert.ok(result.stdout.includes(`${url}#three`), result.stdout);
  const html = readPage(folder);
  assert.match(html, /Title one/);
  assert.match(html, /What two changes for users\./);
});

test('escapes every piece of plan text', () => {
  const folder = started(sandbox);
  const hostile = '<script>alert(1)</script>';
  writePlan(
    folder,
    plan({
      banner: `Banner ${hostile}`,
      tally: [{ value: 3, label: `merged ${hostile}` }],
      yesterday: [
        {
          title: `Group ${hostile}`,
          hint: `Hint ${hostile}`,
          items: [
            item('one', {
              title: `Title ${hostile}`,
              summary: `Summary ${hostile}`,
              kind: `Kind ${hostile}`,
              refs: `Refs ${hostile}`,
              status: { label: `Status ${hostile}`, tone: 'ok' },
              product: `Product ${hostile}`,
              tech: [`Tech ${hostile}`],
              links: [{ url: 'https://example.com/?a=1&b="2"', label: `Link ${hostile}` }],
            }),
          ],
        },
      ],
    }),
  );

  const result = sandbox.run(['render', folder]);

  assert.equal(result.status, 0, result.stderr);
  const html = readPage(folder);
  assert.ok(!html.includes(hostile), 'raw markup leaked into the page');
  for (const label of ['Banner', 'merged', 'Group', 'Hint', 'Title', 'Summary', 'Kind', 'Refs', 'Status', 'Product', 'Tech', 'Link']) {
    assert.ok(html.includes(`${label} &lt;script&gt;alert(1)&lt;/script&gt;`), label);
  }
  assert.ok(html.includes('href="https://example.com/?a=1&amp;b=&quot;2&quot;"'));
});

test('turns backticks into code and [label](https) into links, in product, tech, hint and banner', () => {
  const folder = started(sandbox);
  writePlan(
    folder,
    plan({
      banner: 'First lot `P0` done, see [the tracker](https://example.com/p0).',
      yesterday: [
        {
          title: 'Merged',
          hint: 'See [the spec](https://example.com/spec).',
          items: [
            item('one', {
              product: 'First paragraph with [a link](https://example.com/a).\n\n- one point\n- `another` point',
              tech: ['Calls `createServer({ mailer })`.'],
            }),
          ],
        },
      ],
    }),
  );

  const result = sandbox.run(['render', folder]);

  assert.equal(result.status, 0, result.stderr);
  const html = readPage(folder);
  assert.ok(html.includes('<a href="https://example.com/spec" target="_blank" rel="noopener">the spec</a>'));
  assert.ok(html.includes('<p>First paragraph with <a href="https://example.com/a" target="_blank" rel="noopener">a link</a>.</p>'));
  assert.ok(html.includes('<ul><li>one point</li><li><code>another</code> point</li></ul>'));
  assert.ok(html.includes('Calls <code>createServer({ mailer })</code>.'));
  assert.ok(html.includes('<p>First lot <code>P0</code> done, see <a href="https://example.com/p0" target="_blank" rel="noopener">the tracker</a>.</p>'));
});

test('rejects a broken plan, listing every violation at once', () => {
  const folder = started(sandbox);
  writePlan(
    folder,
    plan({
      banner: 'A [bad link](javascript:void(0)).',
      tally: [{ value: 3 }],
      yesterday: [
        {
          title: 'Merged',
          items: [
            item('one', { product: '' }),
            item('one'),
            item('Bad Id'),
            item('four', { status: { label: 'Done', tone: 'shiny' } }),
            item('five', { links: [{ url: 'http://example.com', label: 'Insecure' }] }),
            item('six', { tech: ['A [script link](javascript:alert(1)).'] }),
          ],
        },
        { title: 'Empty', items: [] },
      ],
    }),
  );

  const result = sandbox.run(['render', folder]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /one: product is empty/);
  assert.match(result.stderr, /one: id is used more than once/);
  assert.match(result.stderr, /Bad Id: id must be lowercase words joined by hyphens/);
  assert.match(result.stderr, /four: status tone must be one of ok, review, draft, todo, warn/);
  assert.match(result.stderr, /five: link http:\/\/example\.com must start with https:\/\//);
  assert.match(result.stderr, /six: link javascript:alert\(1\) must start with https:\/\//);
  assert.match(result.stderr, /yesterday group "Empty" has no items/);
  assert.match(result.stderr, /banner: link javascript:void\(0\) must start with https:\/\//);
  assert.match(result.stderr, /tally must be a list of \{ value, label \}/);
});

test('rejects a missing or unreadable plan', () => {
  const folder = started(sandbox);

  assert.match(sandbox.run(['render', folder]).stderr, /plan\.json/);

  writePlan(folder, 'not an object');
  assert.match(sandbox.run(['render', folder]).stderr, /plan\.json/);
});

test('labels the page in the start language, with dates written in it', () => {
  const folder = started(sandbox, ['--lang', 'fr']);
  writePlan(folder, plan());

  const result = sandbox.run(['render', folder]);

  assert.equal(result.status, 0, result.stderr);
  const html = readPage(folder);
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /Hier/);
  assert.match(html, /Aujourd’hui/);
  assert.match(html, /Blocages/);
  assert.match(html, /Résumé produit/);
  assert.match(html, /Jeudi 19 novembre 2026/);
  assert.match(html, /mercredi 18 novembre 2026/);
});

test("counts today's done items with the singular for a single item", () => {
  const folder = started(sandbox, ['--lang', 'fr']);
  writePlan(folder, plan());

  assert.equal(sandbox.run(['render', folder]).status, 0);

  assert.match(readPage(folder), /<span id="done-count">0<\/span> \/ 1 fait</);
});

test('names link badges in the page language, brands as they are', () => {
  const folder = started(sandbox, ['--lang', 'fr']);
  const links = [
    { url: 'https://example.com/', label: 'Site' },
    { url: 'https://www.notion.so/acme/Ticket-123', label: 'Ticket' },
  ];
  writePlan(folder, plan({ yesterday: [{ title: 'Mergé', items: [item('one', { links })] }] }));

  const result = sandbox.run(['render', folder]);

  assert.equal(result.status, 0, result.stderr);
  const html = readPage(folder);
  assert.ok(html.includes('<span class="src-text">Lien</span>'));
  assert.ok(html.includes('<span class="src-text">Notion</span>'));
});

test('heads the first section by how far back it starts: yesterday, a weekday this week, a date beyond', () => {
  const heading = (args: string[]) => {
    const folder = started(sandbox, args);
    writePlan(folder, plan());
    assert.equal(sandbox.run(['render', folder]).status, 0);
    return readPage(folder).match(/<h2 id="section-yesterday">(.*?)<\/h2><span class="when">(.*?)<\/span>/)!.slice(1);
  };

  assert.deepEqual(heading(['--since', '2026-11-18']), ['Yesterday', 'Wednesday, November 18, 2026']);
  const [weekday, range] = heading(['--since', '2026-11-17']);
  assert.equal(weekday, 'Tuesday');
  assert.match(range, /November 17/);
  assert.match(range, /18/);
  assert.equal(heading(['--since', '2026-11-05'])[0], 'Since November 5');
  assert.equal(heading(['--since', '2026-11-05', '--lang', 'fr'])[0], 'Depuis le 5 novembre');
  assert.equal(heading(['--since', '2026-11-17', '--lang', 'fr'])[0], 'Mardi');
});

test('a language without built-in labels needs every label in the plan', () => {
  const folder = started(sandbox, ['--lang', 'de']);
  writePlan(folder, plan({ labels: { today: 'Heute' } }));

  const missing = sandbox.run(['render', folder]);

  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /labels for de are missing: .*yesterday/);
  assert.doesNotMatch(missing.stderr, /missing: .*\btoday\b/);

  const en = JSON.parse(sandbox.run(['labels']).stdout);
  const de = Object.fromEntries(Object.keys(en).map((key) => [key, `DE ${key}`]));
  writePlan(folder, plan({ labels: { ...de, today: 'Heute' } }));

  const complete = sandbox.run(['render', folder]);

  assert.equal(complete.status, 0, complete.stderr);
  assert.match(readPage(folder), /Heute/);
});

test('rejects unknown label keys', () => {
  const folder = started(sandbox);
  writePlan(folder, plan({ labels: { tomorrow: 'Tomorrow' } }));

  const result = sandbox.run(['render', folder]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown label tomorrow/);
});

test('names each link by where it points', () => {
  const folder = started(sandbox);
  const links = [
    ['https://github.com/acme/app/pull/12', 'pull-request'],
    ['https://github.com/acme/app/issues/7', 'issue'],
    ['https://github.com/acme/app/blob/main/docs/adr.md', 'document'],
    ['https://www.notion.so/acme/Ticket-123', 'notion'],
    ['https://app.notion.com/p/abc', 'notion'],
    ['https://linear.app/acme/issue/APP-1', 'linear'],
    ['https://acme.atlassian.net/browse/APP-1', 'jira'],
    ['https://example.com/', 'web'],
  ];
  writePlan(
    folder,
    plan({
      yesterday: [{ title: 'Merged', items: [item('one', { links: links.map(([url]) => ({ url, label: url })) })] }],
    }),
  );

  const result = sandbox.run(['render', folder]);

  assert.equal(result.status, 0, result.stderr);
  const html = readPage(folder);
  for (const [url, source] of links) {
    assert.ok(html.includes(`data-source="${source}"><a href="${url}"`), `${url} → ${source}`);
  }
});

test('allows its only script by hash and nothing else', () => {
  const folder = started(sandbox);
  writePlan(folder, plan());

  assert.equal(sandbox.run(['render', folder]).status, 0);

  const html = readPage(folder);
  const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), ([, body]) => body);
  assert.equal(scripts.length, 1);
  const hash = createHash('sha256').update(scripts[0]).digest('base64');
  assert.ok(
    html.includes(`content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'"`),
    'the Content-Security-Policy does not allow exactly the page script',
  );
});
