// Helpers for tests that need a prepared change and a rendered page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fakeGh, pullRequestRepo } from './github.ts';
import type { Sandbox } from './sandbox.ts';

/** The work folder `prepare` writes for `target` (`feature`, `PR-7`, `PR-7-since-<sha>`) of the sandbox's `repository`. */
export function workFolder(sandbox: Sandbox, target: string, repository = 'project'): string {
  return path.join(sandbox.tmp, 'review-tour', `${repository}-${target}`);
}

/** A changed file as `change.json` records it. */
export type RecordedFile = { path: string; proofs?: string[]; generated?: string };

/** The files `prepare` recorded in `folder`, by path. */
export function filesOf(folder: string): Map<string, RecordedFile> {
  const change = JSON.parse(fs.readFileSync(path.join(folder, 'change.json'), 'utf8'));
  return new Map(change.files.map((file: RecordedFile) => [file.path, file]));
}

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
  return { repo, folder: workFolder(sandbox, 'feature') };
}

/**
 * Pull request #7 of acme/project: the author's `feature` (null deletes a
 * file) on top of `trunk`, renames first, published, then `prepare 7` run in
 * the reviewer's clone. `head` is the pull request's head.
 */
export function preparePullRequest(
  sandbox: Sandbox,
  files: { trunk: Record<string, string>; feature: Record<string, string | null> },
  renames: Record<string, string> = {},
) {
  const world = pullRequestRepo(sandbox, files.trunk);
  for (const [from, to] of Object.entries(renames)) world.author.git('mv', from, to);
  world.author.write(files.feature);
  world.author.commit('feature');
  const view = world.publish();
  fakeGh(sandbox, [{ args: ['pr', 'view'], stdout: view }]);
  const prepared = sandbox.run(['prepare', '7'], { cwd: world.clone.dir });
  assert.equal(prepared.status, 0, prepared.stderr);
  return { ...world, folder: workFolder(sandbox, 'PR-7'), head: view.headRefOid };
}

/** A valid intent, for plans whose test is not about the intent. */
export const sampleIntent = {
  why: 'Explain why the change exists.',
  visual: 'start()\n  finish()',
  mergeDanger: { door: 'two-way', blastRadius: 'none' },
};

/** Puts a step without a `tier` key in core logic, for plans whose test is not about tiers. */
const withTier = (step: unknown) =>
  typeof step === 'object' && step !== null && !('tier' in step) ? { tier: 'core-logic', ...step } : step;

/**
 * Writes the tour plan, adding `sampleIntent` unless the plan has an `intent`
 * key, and the core-logic tier to every step without a `tier` key.
 */
export function writePlan(folder: string, plan: object): void {
  const full: Record<string, unknown> = 'intent' in plan ? { ...plan } : { intent: sampleIntent, ...plan };
  if (Array.isArray(full.steps)) full.steps = full.steps.map(withTier);
  fs.writeFileSync(path.join(folder, 'plan.json'), JSON.stringify(full, null, 2));
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
