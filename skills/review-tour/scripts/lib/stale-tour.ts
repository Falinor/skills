// The stale-tour gate. Before the tool writes anything to GitHub (a Viewed
// tick, a comment), the pull request must still be at the head the tour was
// built from: otherwise the reviewer would vouch for code they never saw.
import { UserError } from './errors.ts';
import { graphql } from './gh.ts';
import { repositoryOf } from './pull-request.ts';
import { requireTools } from './requirements.ts';
import type { Change } from './work-folder.ts';

/** The tour's pull request as GitHub has it now. */
export type FreshPullRequest = {
  /** Where to send further GraphQL calls about it. */
  host: string;
  /** Its node id, which every mutation takes. */
  id: string;
  headRefOid: string;
};

/** PullRequest fields to read beside its id and head, with the GraphQL variables they use; a null value leaves one unset. */
export type Selection = { fields: string; variables?: Record<string, { type: string; value: string | number | null }> };

/**
 * Reads the tour's pull request from GitHub, with the fields `selection`
 * names beside its id and head. Refuses a local-branch tour, which has no
 * pull request, and a stale tour. `consequence` ends both refusals, such as
 * "nothing was ticked".
 */
export function freshPullRequest<T extends object = object>(
  change: Change,
  consequence: string,
  { fields, variables = {} }: Selection = { fields: '' },
): FreshPullRequest & T {
  const pullRequest = change.pullRequest;
  if (!pullRequest) {
    throw new UserError(`this tour is of the local branch ${change.target}, which has no pull request on GitHub, so ${consequence}.`);
  }
  requireTools(['gh']);
  const { host, owner, name } = repositoryOf(pullRequest.url);
  const declarations = Object.entries(variables).map(([variable, { type }]) => `, $${variable}: ${type}`).join('');
  const values = Object.entries(variables).flatMap(([variable, { value }]) => (value === null ? [] : [[variable, value] as const]));
  const data = graphql<{ repository: { pullRequest: Omit<FreshPullRequest, 'host'> & T } }>(
    host,
    `query($owner: String!, $name: String!, $number: Int!${declarations}) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { id headRefOid ${fields} } }
}`,
    { owner, name, number: pullRequest.number, ...Object.fromEntries(values) },
  );
  const live = data.repository.pullRequest;
  if (live.headRefOid !== change.head) {
    throw new UserError(
      `the tour is stale: pull request #${pullRequest.number} moved from the toured head ${change.head.slice(0, 12)} to ${live.headRefOid.slice(0, 12)}, so ${consequence}.\n` +
        `Build a follow-up tour of what changed since: /review-tour ${pullRequest.number} since ${change.head}`,
    );
  }
  return { host, ...live };
}
