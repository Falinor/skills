// `viewed`: ticks the files of the steps the reviewer finished as Viewed on
// the pull request, so GitHub reflects their progress.
import path from 'node:path';
import { parseCommandArgs } from './args.ts';
import { UserError } from './errors.ts';
import { graphql } from './gh.ts';
import { mechanicalBatch } from './mechanical-batch.ts';
import type { TourPlan } from './plan.ts';
import { printablePath } from './printable.ts';
import { freshPullRequest } from './stale-tour.ts';
import { readTour } from './tour.ts';
import type { Change } from './work-folder.ts';

const usage = [
  'usage: review-tour viewed <work-folder> <steps|mechanical>',
  '  steps: a step number (3), a range (1-4), a list (1,3,5) or both (1-4,7)',
  '  mechanical: the proven mechanical batch, every proven file of the mechanical tier',
].join('\n');

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

/** Every file of the pull request with its viewed state, page by page, each page passing the stale-tour gate. */
function readViewedStates(change: Change) {
  const states = new Map<string, ChangedFileState['viewerViewedState']>();
  let cursor: string | null = null;
  for (;;) {
    const after: string = cursor === null ? '' : `, after: ${JSON.stringify(cursor)}`;
    const page = freshPullRequest<FilesPage>(
      change,
      'nothing was ticked',
      `files(first: 100${after}) { pageInfo { hasNextPage endCursor } nodes { path viewerViewedState } }`,
    );
    for (const node of page.files.nodes) states.set(node.path, node.viewerViewedState);
    const { hasNextPage, endCursor } = page.files.pageInfo;
    if (!hasNextPage || endCursor === null) return { host: page.host, id: page.id, states };
    cursor = endCursor;
  }
}

const count = (files: string[]) => (files.length === 1 ? '1 file' : `${files.length} files`);
const listed = (files: string[]) => files.map((file) => `  ${printablePath(file)}`);

/** Files per mutation, so a failure leaves at most this many in doubt. */
const batchSize = 25;

/** Ticks `files` batch by batch; when GitHub fails, prints what it ticked before and stops, naming the rest. */
function tick(host: string, id: string, files: string[], number: number | undefined): void {
  for (let start = 0; start < files.length; start += batchSize) {
    const batch = files.slice(start, start + batchSize);
    const declarations = batch.map((_, index) => `, $p${index}: String!`).join('');
    const marks = batch
      .map((_, index) => `p${index}: markFileAsViewed(input: { pullRequestId: $pr, path: $p${index} }) { clientMutationId }`)
      .join('\n  ');
    try {
      graphql(host, `mutation($pr: ID!${declarations}) {\n  ${marks}\n}`, {
        pr: id,
        ...Object.fromEntries(batch.map((file, index) => [`p${index}`, file])),
      });
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
      const ticked = files.slice(0, start);
      if (ticked.length > 0) {
        console.log([`Ticked as Viewed on pull request #${number} before GitHub failed: ${count(ticked)}`, ...listed(ticked)].join('\n'));
      }
      const left = files.slice(start);
      throw new UserError([error.message, `GitHub failed while ticking, so these may not be ticked: ${count(left)}`, ...listed(left)].join('\n'));
    }
  }
}

/** Ticks the chosen files as Viewed on the pull request and prints what it ticked. */
export function viewed(args: string[]): void {
  const { positionals } = parseCommandArgs(args, {}, usage, 2);
  const folder = path.resolve(positionals[0]);
  const { change, plan } = readTour(folder);
  const batch = positionals[1] === 'mechanical' ? mechanicalBatch(plan, change) : undefined;
  const files = batch ? batch.proven : chosenFiles(plan, positionals[1]);

  const { host, id, states } = readViewedStates(change);
  const byPath = new Map(change.files.map((file) => [file.path, file]));
  // A rename GitHub didn't detect is listed as the old path deleted and the new one added.
  const githubPaths = (file: string) => [file, byPath.get(file)?.oldPath].filter((name): name is string => name !== undefined && states.has(name));
  const notListed = files.filter((file) => githubPaths(file).length === 0);
  const listedPaths = files.flatMap(githubPaths);
  // DISMISSED means new changes since the reviewer last viewed the file: tick it again.
  const toTick = listedPaths.filter((file) => states.get(file) !== 'VIEWED');
  const alreadyViewed = listedPaths.filter((file) => states.get(file) === 'VIEWED');

  const number = change.pullRequest?.number;
  tick(host, id, toTick, number);
  console.log(
    [
      ...(toTick.length > 0
        ? [`Ticked as Viewed on pull request #${number}: ${count(toTick)}`, ...listed(toTick)]
        : [`Nothing to tick on pull request #${number}.`]),
      ...(alreadyViewed.length > 0 ? [`Already viewed, left as they were: ${count(alreadyViewed)}`, ...listed(alreadyViewed)] : []),
      ...(notListed.length > 0
        ? [`Not among the pull request's files on GitHub, left alone: ${count(notListed)}`, ...listed(notListed)]
        : []),
      ...(batch && batch.declared.length > 0
        ? [`Declared generated, not proven, so left out of the batch: ${count(batch.declared)}`, ...listed(batch.declared)]
        : []),
    ].join('\n'),
  );
}
