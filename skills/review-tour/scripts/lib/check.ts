// `check`: the requirements, before anything is fetched, so the reviewer can
// install difftastic before the tour rather than learn afterwards it was missing.
import { parseCommandArgs } from './args.ts';
import { hasDifftastic } from './difftastic.ts';
import { pullRequestSelector } from './pull-request.ts';
import { requireTools } from './requirements.ts';

const usage = 'usage: review-tour check <pull-request-number|pull-request-url|branch>';

/** What `check` says when difftastic is missing; the tour can still go ahead without it. */
export const difftasticQuestion =
  'difftastic is not on PATH: without it no file can be proven syntax-identical, so a reformat stays out of the mechanical tier. Ask the reviewer once whether they want to install it before the tour, with `brew install difftastic` or `cargo install --locked difftastic` run themselves, and wait for their answer.';

/** Stops when a required tool is missing; asks about difftastic, which is optional. */
export function check(args: string[]): void {
  const { positionals } = parseCommandArgs(args, {}, usage, 1);
  const [target] = positionals;
  const pullRequest = pullRequestSelector(target) !== undefined;
  // git is checked before every command.
  if (pullRequest) requireTools(['gh']);
  const found = pullRequest ? 'git and gh' : 'git';
  console.log(hasDifftastic() ? `Ready: ${found} and difftastic found.` : `Ready: ${found} found.\n${difftasticQuestion}`);
}
