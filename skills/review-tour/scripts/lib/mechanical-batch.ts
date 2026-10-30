// The proven mechanical batch: what the reviewer can tick as Viewed in one
// go, after a single confirmation, without reading it.
import type { TourPlan } from './plan.ts';
import type { Change } from './work-folder.ts';

/**
 * The files of the mechanical tier that carry a mechanical proof. The tier's
 * declared generated files are not proven, so they stay out (`declared`);
 * ticking their step by number ticks them.
 */
export function mechanicalBatch(plan: TourPlan, change: Change): { proven: string[]; declared: string[] } {
  const byPath = new Map(change.files.map((file) => [file.path, file]));
  const isProven = (file: string) => (byPath.get(file)?.proofs?.length ?? 0) > 0;
  const files = plan.steps.filter((step) => step.tier === 'mechanical').flatMap((step) => step.files);
  return { proven: files.filter(isProven), declared: files.filter((file) => !isProven(file)) };
}

/** The question `render` hands the reviewer for a pull request tour with a proven mechanical batch. */
export function mechanicalOffer(plan: TourPlan, change: Change): string | undefined {
  const { proven } = mechanicalBatch(plan, change);
  if (!change.pullRequest || proven.length === 0) return undefined;
  const steps = plan.steps.flatMap((step, index) => (step.files.some((file) => proven.includes(file)) ? [index + 1] : []));
  const files = proven.length === 1 ? 'the proven mechanical file' : `the ${proven.length} proven mechanical files`;
  const where = steps.length === 1 ? `step ${steps[0]}` : `steps ${steps.join(', ')}`;
  return `## Viewed on GitHub\n\nTick ${files} (${where}) as Viewed on pull request #${change.pullRequest.number} in one batch?`;
}
