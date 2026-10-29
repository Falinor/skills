// Follow-up tour: only what changed since an earlier tour's head, so the
// reviewer rereads the author's new edits and nothing else. When that head
// can't anchor the range, the tour covers the full change and says why:
// a wrong range would hide edits the reviewer never saw.
import { commitOf, tryGit } from './git.ts';
import type { FollowUp } from './work-folder.ts';

type Tour = {
  /** The earlier tour's head, as the reviewer gave it. */
  since: string;
  target: string;
  head: string;
  baseCommit: string;
  mergeBase: string;
};

const fullChange = (since: string, fallback: string): FollowUp => ({ since, fallback });

/** The range of a follow-up tour: from the earlier head, or from its replay when the base was merged in since. */
export function followUpRange(root: string, { since, target, head, baseCommit, mergeBase }: Tour): FollowUp {
  const earlier = commitOf(root, since);
  if (!earlier) return fullChange(since, `${since} names no commit here; a force-push has likely dropped it`);
  if (tryGit(root, ['merge-base', '--is-ancestor', earlier, head]).status !== 0) {
    return fullChange(since, `${since} is no longer in the history of ${target}; it was rewritten since (force-push or rebase)`);
  }
  const earlierBase = tryGit(root, ['merge-base', baseCommit, earlier]);
  if (earlierBase.status !== 0) return fullChange(since, `${since} shares no history with the base`);
  if (earlierBase.stdout.trim() === mergeBase) return { since, from: earlier };

  // The base was merged in since: `earlier..head` would show the base's
  // changes as the author's. Replay what the earlier tour showed onto the new
  // merge base and start from that tree instead.
  const replay = tryGit(root, [
    'merge-tree', '--write-tree', '--no-messages', `--merge-base=${earlierBase.stdout.trim()}`, mergeBase, earlier,
  ]);
  if (replay.status === 0) return { since, from: replay.stdout.trim(), replayed: true };
  return fullChange(
    since,
    `the base was merged in since ${since}, and replaying ${since} onto the new merge base ` +
      (replay.status === 1 ? 'conflicts' : `failed: ${replay.stderr.trim()}`),
  );
}

/** What `prepare` tells about the range. */
export function describeFollowUp({ since, from, replayed, fallback }: FollowUp): string {
  if (!from) return `Follow-up: covers the full change, because ${fallback}.`;
  const replay = replayed
    ? ` The base was merged in since ${since}, so ${since} was replayed onto the new merge base to leave the base's changes out.`
    : '';
  return `Follow-up: only what changed since ${since}.${replay}`;
}
