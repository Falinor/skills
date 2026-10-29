// `viewed`: ticks the files of the steps the reviewer finished as Viewed on
// the pull request, so GitHub reflects their progress.
import path from 'node:path';
import { parseCommandArgs } from './args.ts';
import { UserError } from './errors.ts';
import { graphql } from './gh.ts';
import { cutPatch } from './patch.ts';
import { validatePlan, type TourPlan } from './plan.ts';
import { readPlan } from './render.ts';
import { freshPullRequest } from './stale-tour.ts';
import { readCapture } from './work-folder.ts';

const usage = 'usage: review-tour viewed <work-folder> <steps>\n  steps: a step number (3), a range (1-4), a list (1,3,5) or both (1-4,7)';

type ChangedFileState = { path: string; viewerViewedState: 'VIEWED' | 'UNVIEWED' | 'DISMISSED' };

type FilesPage = {
  files: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ChangedFileState[] };
};

/** The step numbers `selection` names, in its order: `3`, `1-4` (or `1–4`), `1,3,5`, `1-4,7`. */
function chosenSteps(plan: TourPlan, selection: string): number[] {
  return selection.split(',').flatMap((item) => {
    const match = /^\s*(\d+)(?:\s*[-–—]\s*(\d+))?\s*$/.exec(item);
    if (!match) throw new UserError(`"${item}" is not a step number or range.\n${usage}`);
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (first < 1 || last > plan.steps.length || first > last) {
      throw new UserError(`"${item.trim()}" names steps the tour lacks: the tour has ${plan.steps.length} steps.\n${usage}`);
    }
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  });
}

/** The files of the steps `selection` names. */
function chosenFiles(plan: TourPlan, selection: string): string[] {
  return chosenSteps(plan, selection).flatMap((step) => plan.steps[step - 1].files);
}

const count = (files: string[]) => (files.length === 1 ? '1 file' : `${files.length} files`);
const listed = (files: string[]) => files.map((file) => `  ${file}`);

/** Ticks the chosen files as Viewed on the pull request and prints what it ticked. */
export function viewed(args: string[]): void {
  const { positionals } = parseCommandArgs(args, {}, usage, 2);
  const folder = path.resolve(positionals[0]);
  const { change, patch } = readCapture(folder);
  const plan = validatePlan(readPlan(folder), change, cutPatch(patch, change.files));
  const files = chosenFiles(plan, positionals[1]);

  const page = freshPullRequest<FilesPage>(
    change,
    'nothing was ticked',
    'files(first: 100) { pageInfo { hasNextPage endCursor } nodes { path viewerViewedState } }',
  );
  const states = new Map(page.files.nodes.map((node) => [node.path, node.viewerViewedState]));
  // DISMISSED means new changes since the reviewer last viewed the file: tick it again.
  const toTick = files.filter((file) => states.has(file) && states.get(file) !== 'VIEWED');
  const alreadyViewed = files.filter((file) => states.get(file) === 'VIEWED');

  if (toTick.length > 0) {
    const declarations = toTick.map((_, index) => `, $p${index}: String!`).join('');
    const marks = toTick
      .map((_, index) => `p${index}: markFileAsViewed(input: { pullRequestId: $pr, path: $p${index} }) { clientMutationId }`)
      .join('\n  ');
    graphql(page.host, `mutation($pr: ID!${declarations}) {\n  ${marks}\n}`, {
      pr: page.id,
      ...Object.fromEntries(toTick.map((file, index) => [`p${index}`, file])),
    });
  }

  const number = change.pullRequest?.number;
  console.log(
    [
      ...(toTick.length > 0
        ? [`Ticked as Viewed on pull request #${number}: ${count(toTick)}`, ...listed(toTick)]
        : [`Nothing to tick on pull request #${number}.`]),
      ...(alreadyViewed.length > 0 ? [`Already viewed, left as they were: ${count(alreadyViewed)}`, ...listed(alreadyViewed)] : []),
    ].join('\n'),
  );
}
