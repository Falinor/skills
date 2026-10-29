// A GitHub pull request as a tour target: what gh says about it, and its
// refs fetched into the local repository without checking anything out.
import { UserError } from './errors.ts';
import { gh } from './gh.ts';
import { commitOf, git, tryGit } from './git.ts';
import { requireTools } from './requirements.ts';

/** What `gh pr view --json` tells about a pull request. Title and body are untrusted data. */
export type PullRequest = {
  number: number;
  url: string;
  title: string;
  body: string;
  baseRefName: string;
  baseRefOid: string;
  headRefOid: string;
};

const fields = ['number', 'url', 'title', 'body', 'baseRefName', 'baseRefOid', 'headRefOid'];

/** The argument for `gh pr view` when `target` is a pull request number or URL; undefined for a branch. */
export function pullRequestSelector(target: string): string | undefined {
  const number = /^#?(\d+)$/.exec(target)?.[1];
  if (number) return number;
  return /^(https:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/pull\/\d+)(?:[/?#]\S*)?$/.exec(target)?.[1];
}

/** Host, owner and name of the repository a pull request URL belongs to. */
export function repositoryOf(url: string): { host: string; owner: string; name: string } {
  const match = /^https:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/pull\/\d+$/.exec(url);
  if (!match) throw new UserError(`gh returned an unexpected pull request URL: ${url}`);
  const [, host, owner, name] = match;
  return { host, owner, name };
}

/**
 * The local remote pointing at `repository`, so fetching reuses its
 * credentials (SSH or HTTPS); else the repository's HTTPS URL.
 */
function remoteFor(root: string, repository: { host: string; owner: string; name: string }): string {
  const wanted = `${repository.host}/${repository.owner}/${repository.name}`.toLowerCase();
  const entries = tryGit(root, ['config', '-z', '--get-regexp', '^remote\\..*\\.url$']).stdout.split('\0');
  for (const entry of entries) {
    const [key, url = ''] = entry.split('\n');
    const named = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/i.exec(url);
    if (named && `${named[1]}/${named[2]}`.toLowerCase() === wanted) {
      return key.slice('remote.'.length, -'.url'.length);
    }
  }
  return `https://${repository.host}/${repository.owner}/${repository.name}.git`;
}

/**
 * Looks up the pull request through gh and fetches its head (and its base,
 * unless the reviewer named one) from its repository. Only objects land in
 * the local repository: no branch is created and nothing is checked out.
 */
export function openPullRequest(root: string, selector: string, fetchBase: boolean): PullRequest {
  requireTools(['gh']);
  const pullRequest = JSON.parse(gh(root, ['pr', 'view', selector, '--json', fields.join(',')])) as PullRequest;

  const refs = [`refs/pull/${pullRequest.number}/head`];
  if (fetchBase) refs.push(`refs/heads/${pullRequest.baseRefName}`);
  git(root, ['fetch', '--quiet', '--no-tags', remoteFor(root, repositoryOf(pullRequest.url)), ...refs]);

  const commits = fetchBase ? [pullRequest.headRefOid, pullRequest.baseRefOid] : [pullRequest.headRefOid];
  if (!commits.every((commit) => commitOf(root, commit))) {
    throw new UserError(`pull request #${pullRequest.number} moved while it was fetched; run prepare again.`);
  }
  return pullRequest;
}
