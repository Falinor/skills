// `comment`: adds the reviewer's comment on a file and line to their pending
// review on the pull request. A pending review stays visible only to them
// until they submit it on GitHub themselves; the tool never submits one.
import path from 'node:path';
import { parseCommandArgs } from './args.ts';
import { UserError } from './errors.ts';
import { graphql } from './gh.ts';
import { cutPatch } from './patch.ts';
import { misplacedAnchor } from './plan.ts';
import { freshPullRequest } from './stale-tour.ts';
import { readCapture } from './work-folder.ts';

const usage = [
  'usage: review-tour comment <work-folder> <file> <line> [--side new|old] --body <text>',
  '  file: a path as change.json lists it; line: a line number the diff shows on that side',
  '  side: new (the default) for added and context lines, old for removed lines',
].join('\n');

type PendingReviews = { reviews: { nodes: { id: string; viewerDidAuthor: boolean }[] } };

const refused = 'no comment was added';

/** The comment the arguments ask for, once its line is one the change's diff shows on that side. */
function requestedComment(args: string[]) {
  const { positionals, values } = parseCommandArgs(
    args,
    { side: { type: 'string', default: 'new' }, body: { type: 'string' } },
    usage,
    3,
  );
  const [folder, file, line] = positionals;
  const { side = 'new', body = '' } = values;
  if (side !== 'new' && side !== 'old') throw new UserError(`--side must be "new" or "old", so ${refused}.\n${usage}`);
  if (!/^[1-9]\d*$/.test(line)) throw new UserError(`"${line}" is not a line number, so ${refused}.\n${usage}`);
  if (body.trim() === '') throw new UserError(`--body must hold the comment's text, so ${refused}.\n${usage}`);

  const { change, patch } = readCapture(path.resolve(folder));
  // GitHub's old side is the pull request's base; a narrowed follow-up's is the earlier head.
  if (side === 'old' && change.followUp?.from !== undefined) {
    throw new UserError(
      `the old side of this follow-up tour is the earlier head ${change.followUp.since}, not the pull request's base, so ${refused}. Comment on a new line, or on the old side from a full tour.`,
    );
  }
  const diff = cutPatch(patch, change.files).get(file);
  if (!diff) throw new UserError(`${file} is not among the change's files (see change.json), so ${refused}.`);
  const anchor = { file, line: Number(line), side } as const;
  // GitHub takes line comments only on lines its diff shows.
  const misplaced = misplacedAnchor(anchor, diff);
  if (misplaced) throw new UserError(`${misplaced}, so ${refused}.`);
  return { change, ...anchor, body };
}

/** Adds the comment to the reviewer's pending review, starting one when they have none. */
export function comment(args: string[]): void {
  const { change, file, line, side, body } = requestedComment(args);

  const pullRequest = freshPullRequest<PendingReviews>(
    change,
    refused,
    'reviews(states: [PENDING], first: 100) { nodes { id viewerDidAuthor } }',
  );
  // Pending reviews are visible only to their author; GitHub allows one per reviewer.
  const pending = pullRequest.reviews.nodes.find((review) => review.viewerDidAuthor);
  const thread = { path: file, line, side: side === 'old' ? 'LEFT' : 'RIGHT', body };
  if (pending) {
    graphql(
      pullRequest.host,
      `mutation($review: ID!, $path: String!, $line: Int!, $side: DiffSide!, $body: String!) {
  addPullRequestReviewThread(input: { pullRequestReviewId: $review, path: $path, line: $line, side: $side, body: $body, subjectType: LINE }) {
    thread { id }
  }
}`,
      { review: pending.id, ...thread },
    );
  } else {
    // Without an event, the new review stays pending.
    graphql(
      pullRequest.host,
      `mutation($pr: ID!, $commit: GitObjectID!, $path: String!, $line: Int!, $side: DiffSide!, $body: String!) {
  addPullRequestReview(input: { pullRequestId: $pr, commitOID: $commit, threads: [{ path: $path, line: $line, side: $side, body: $body }] }) {
    pullRequestReview { id state }
  }
}`,
      { pr: pullRequest.id, commit: change.head, ...thread },
    );
  }

  const number = change.pullRequest?.number;
  console.log(
    [
      pending
        ? `Added a comment on ${file}, ${side} line ${line}, to your pending review on pull request #${number}.`
        : `Started your pending review on pull request #${number} with a comment on ${file}, ${side} line ${line}.`,
      `It stays pending: only you can see it until you submit the review yourself on GitHub.`,
    ].join('\n'),
  );
}
