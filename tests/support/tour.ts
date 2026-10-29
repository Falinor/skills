// Helpers for tests that need a prepared change and a rendered page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Sandbox } from './sandbox.ts';

/**
 * Builds a repository whose `feature` branch applies `feature` (null deletes
 * a file) on top of `trunk`, then runs `prepare feature --base trunk`.
 */
export function prepareChange(
  sandbox: Sandbox,
  files: { trunk: Record<string, string>; feature: Record<string, string | null> },
  renames: Record<string, string> = {},
) {
  const repo = sandbox.repo();
  repo.write(files.trunk);
  repo.commit('start');
  repo.git('checkout', '-q', '-b', 'feature');
  for (const [from, to] of Object.entries(renames)) repo.git('mv', from, to);
  repo.write(files.feature);
  repo.commit('feature');
  const result = sandbox.run(['prepare', 'feature', '--base', 'trunk'], { cwd: repo.dir });
  assert.equal(result.status, 0, result.stderr);
  return { repo, folder: path.join(sandbox.tmp, 'review-tour', 'project-feature') };
}

export function writePlan(folder: string, plan: unknown): void {
  fs.writeFileSync(path.join(folder, 'plan.json'), JSON.stringify(plan, null, 2));
}

/** The visible text of the `#step-N` section of a rendered page. */
export function stepText(html: string, step: number): string {
  const start = html.search(new RegExp(`<section[^>]*\\bid="step-${step}"`));
  assert.notEqual(start, -1, `no #step-${step} section`);
  const section = html.slice(start, html.indexOf('</section>', start));
  return section
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
