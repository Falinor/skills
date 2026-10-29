// A tour whose plan prose and diffs are full of hostile text: a pull request
// trying to run code in the reviewer's browser. Every payload sets
// `window.__pwned`, opens a dialog or loads a resource if it ever runs.
import assert from 'node:assert/strict';
import path from 'node:path';
import type { Sandbox } from './sandbox.ts';
import { prepareChange, writePlan } from './tour.ts';

export const payloads = [
  '<script>window.__pwned = 1; alert("script")</script>',
  `<img src="https://example.invalid/img.png" onerror="window.__pwned = 1; alert('img')">`,
  `<svg onload="window.__pwned = 1; alert('svg')"></svg>`,
  `<a href="javascript:window.__pwned = 1; alert('link')">click me</a>`,
  '[click me](javascript:window.__pwned=1)',
  '"><iframe src="https://example.invalid/frame"></iframe>',
  '<style>body { background: url(https://example.invalid/css) }</style>',
];

/** A Markdown link that tries to break out of its href attribute. */
export const breakout = '[docs](https://example.invalid/"onmouseover="window.__pwned=1)';

/** A file name that is itself markup. */
export const hostileName = '<img src=x onerror=alert(1)>.html';

/** Prepares, plans and renders the hostile tour; returns the page path. */
export function renderHostileTour(sandbox: Sandbox): string {
  const content = `${payloads.join('\n')}\n`;
  const { folder, repo } = prepareChange(sandbox, {
    trunk: { 'hostile.html': 'start\n' },
    feature: { 'hostile.html': `start\n${content}`, [hostileName]: content },
  });
  writePlan(folder, {
    steps: [
      {
        title: payloads[0],
        files: ['hostile.html', hostileName],
        explanation: [...payloads, breakout].join('\n\n'),
        questions: payloads,
        pseudocode: payloads.join('\n'),
        trace: { input: payloads[1], old: payloads, new: payloads.slice(1) },
        callouts: payloads.map((text, index) => ({
          file: 'hostile.html',
          line: index + 2,
          side: 'new',
          tag: 'Security',
          text,
        })),
      },
    ],
  });
  const result = sandbox.run(['render', folder], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
  return path.join(folder, 'tour.html');
}
