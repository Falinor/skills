// A tour read back from its work folder: what `prepare` captured, its patch
// cut per file, and the agent's tour plan once it obeys every rule.
import { cutPatch, type FileDiff } from './patch.ts';
import { validatePlan, type TourPlan } from './plan.ts';
import { readCapture, readPlan, readSources, type Change } from './work-folder.ts';

/** The captured change with its patch cut into per-file diffs. */
export function readChange(folder: string): { change: Change; diffs: Map<string, FileDiff> } {
  const { change, patch } = readCapture(folder);
  return { change, diffs: cutPatch(patch, change.files, readSources(folder)) };
}

/** The captured change, its diffs and its tour plan; stops with every violation when the plan breaks a rule. */
export function readTour(folder: string): { change: Change; diffs: Map<string, FileDiff>; plan: TourPlan } {
  const { change, diffs } = readChange(folder);
  return { change, diffs, plan: validatePlan(readPlan(folder), change, diffs) };
}
