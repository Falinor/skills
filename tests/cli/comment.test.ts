import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fakeGh, pullRequestRepo, type GhAnswer } from '../support/github.ts';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';
import { prepareChange } from '../support/tour.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.cleanup());

/** Pull request #7, prepared: a.txt's second line rewritten, b.txt added. */
function pullRequestTour() {
  const world = pullRequestRepo(sandbox, { 'a.txt': 'one\ntwo\nthree\n' });
  world.author.write({ 'a.txt': 'one\nTWO\nthree\n', 'b.txt': 'b\n' });
  world.author.commit('feature');
  const view = world.publish();
  fakeGh(sandbox, [{ args: ['pr', 'view'], stdout: view }]);
  const prepared = sandbox.run(['prepare', '7'], { cwd: world.clone.dir });
  assert.equal(prepared.status, 0, prepared.stderr);
  return { ...world, folder: path.join(sandbox.tmp, 'review-tour', 'project-PR-7'), head: view.headRefOid };
}

type PendingReview = { id: string; viewerDidAuthor: boolean };

/** The pull request as GitHub's GraphQL API answers it: at `head`, with these pending reviews. */
function pullRequestState(head: string, pending: PendingReview[]) {
  return { data: { repository: { pullRequest: { id: 'PR_kw7', headRefOid: head, reviews: { nodes: pending } } } } };
}

/** A fake GitHub whose pull request is at `head` with these pending reviews. */
function github(head: string, pending: PendingReview[] = [], before: GhAnswer[] = []) {
  return fakeGh(sandbox, [
    ...before,
    {
      args: ['api', 'graphql'],
      includes: 'addPullRequestReviewThread',
      stdout: { data: { addPullRequestReviewThread: { thread: { id: 'PRRT_1' } } } },
    },
    {
      args: ['api', 'graphql'],
      includes: 'addPullRequestReview(',
      stdout: { data: { addPullRequestReview: { pullRequestReview: { id: 'PRR_new', state: 'PENDING' } } } },
    },
    { args: ['api', 'graphql'], includes: 'reviews(states: [PENDING]', stdout: pullRequestState(head, pending) },
  ]);
}

const isMutation = (call: string[]) => call.some((arg) => /^query=mutation\b/.test(arg));

/** The variables a GraphQL call sent, raw (-f) and typed (-F) alike, the query left out. */
function variables(call: string[]): Record<string, string> {
  return Object.fromEntries(
    call.flatMap((arg, index) =>
      (call[index - 1] === '-f' || call[index - 1] === '-F') && !arg.startsWith('query=')
        ? [[arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]]
        : [],
    ),
  );
}

/** Never submits, approves or requests changes. */
function neverSubmits(log: string[][]) {
  const sent = log.flat().join('\n');
  for (const forbidden of [/submitPullRequestReview/, /\bevent\b/, /APPROVE/, /REQUEST_CHANGES/]) {
    assert.doesNotMatch(sent, forbidden);
  }
  assert.ok(!log.some((call) => call[0] === 'pr' && call[1] === 'review'), 'never runs gh pr review');
}

test('starts a pending review holding the comment when the reviewer has none', () => {
  const tour = pullRequestTour();
  const gh = github(tour.head);

  const result = sandbox.run(['comment', tour.folder, 'a.txt', '2', '--body', 'Why upper case?'], { cwd: tour.clone.dir });

  assert.equal(result.status, 0, result.stderr);
  const mutations = gh.log().filter(isMutation);
  assert.equal(mutations.length, 1);
  assert.match(mutations[0].join(' '), /addPullRequestReview\(/);
  assert.deepEqual(variables(mutations[0]), {
    pr: 'PR_kw7',
    commit: tour.head,
    path: 'a.txt',
    line: '2',
    side: 'RIGHT',
    body: 'Why upper case?',
  });
  neverSubmits(gh.log());
  assert.match(result.stdout, /^Started your pending review on pull request #7 with a comment on a\.txt, new line 2\.$/m);
  assert.match(result.stdout, /only you can see it until you submit the review yourself on GitHub/);
});

test("adds the comment to the reviewer's pending review when they have one", () => {
  const tour = pullRequestTour();
  const gh = github(tour.head, [{ id: 'PRR_mine', viewerDidAuthor: true }]);

  const result = sandbox.run(['comment', tour.folder, 'b.txt', '1', '--body', 'Needed?'], { cwd: tour.clone.dir });

  assert.equal(result.status, 0, result.stderr);
  const mutations = gh.log().filter(isMutation);
  assert.equal(mutations.length, 1);
  assert.match(mutations[0].join(' '), /addPullRequestReviewThread\(/);
  assert.deepEqual(variables(mutations[0]), { review: 'PRR_mine', path: 'b.txt', line: '1', side: 'RIGHT', body: 'Needed?' });
  neverSubmits(gh.log());
  assert.match(result.stdout, /^Added a comment on b\.txt, new line 1, to your pending review on pull request #7\.$/m);
  assert.match(result.stdout, /only you can see it until you submit the review yourself on GitHub/);
});

test('refuses a stale tour, adding no comment, and suggests a follow-up tour', () => {
  const tour = pullRequestTour();
  const gh = github('f'.repeat(40));

  const result = sandbox.run(['comment', tour.folder, 'a.txt', '2', '--body', 'Why?'], { cwd: tour.clone.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`the tour is stale: .* moved from the toured head ${tour.head.slice(0, 12)} to ffffffffffff, so no comment was added`));
  assert.match(result.stderr, new RegExp(`/review-tour 7 since ${tour.head}`));
  assert.deepEqual(gh.log().filter(isMutation), []);
});

test('refuses a local-branch tour without calling GitHub', () => {
  const { folder, repo } = prepareChange(sandbox, { trunk: { 'a.txt': 'one\n' }, feature: { 'a.txt': 'two\n' } });
  const gh = fakeGh(sandbox, []);

  const result = sandbox.run(['comment', folder, 'a.txt', '1', '--body', 'Why?'], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /local branch feature, which has no pull request on GitHub, so no comment was added/);
  assert.deepEqual(gh.log(), []);
});

test('comments on a removed line with --side old, by its old line number', () => {
  const tour = pullRequestTour();
  const gh = github(tour.head);

  const result = sandbox.run(['comment', tour.folder, 'a.txt', '2', '--side', 'old', '--body', 'Still read elsewhere?'], {
    cwd: tour.clone.dir,
  });

  assert.equal(result.status, 0, result.stderr);
  const [mutation] = gh.log().filter(isMutation);
  assert.equal(variables(mutation).side, 'LEFT');
  assert.equal(variables(mutation).line, '2');
  assert.match(result.stdout, /a\.txt, old line 2\.$/m);
});

test('refuses a line the diff does not show, an unknown file and a malformed request, calling GitHub for nothing', () => {
  const tour = pullRequestTour();
  const gh = github(tour.head);

  for (const [args, message] of [
    [['a.txt', '9'], /new line 9 of a\.txt is outside every hunk/],
    [['b.txt', '1', '--side', 'old'], /line 1 of b\.txt is on the new side, not the old/],
    [['c.txt', '1'], /c\.txt is not among the change's files/],
    [['a.txt', 'two'], /"two" is not a line number/],
    [['a.txt', '2', '--side', 'left'], /--side must be "new" or "old"/],
  ] as const) {
    const result = sandbox.run(['comment', tour.folder, ...args, '--body', 'Why?'], { cwd: tour.clone.dir });

    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, message);
    assert.match(result.stderr, /no comment was added/);
  }
  for (const body of [[], ['--body', ' \n']]) {
    const result = sandbox.run(['comment', tour.folder, 'a.txt', '2', ...body], { cwd: tour.clone.dir });

    assert.equal(result.status, 1, body.join(' '));
    assert.match(result.stderr, /--body must hold the comment's text/);
  }
  assert.deepEqual(gh.log().filter((call) => call[0] === 'api'), []);
});

test("refuses the old side of a follow-up tour, whose old lines are the earlier head's, not the pull request's base", () => {
  const world = pullRequestRepo(sandbox, { 'a.txt': 'one\ntwo\n' });
  world.author.write({ 'a.txt': 'one\nTWO\n' });
  world.author.commit('first round');
  const earlier = world.publish();
  fakeGh(sandbox, [{ args: ['pr', 'view'], stdout: earlier }]);
  assert.equal(sandbox.run(['prepare', '7'], { cwd: world.clone.dir }).status, 0);
  world.author.write({ 'a.txt': 'ONE\nTWO\n' });
  world.author.commit('address feedback');
  const view = world.publish();
  fakeGh(sandbox, [{ args: ['pr', 'view'], stdout: view }]);
  const since = earlier.headRefOid.slice(0, 12);
  assert.equal(sandbox.run(['prepare', '7', '--since', since], { cwd: world.clone.dir }).status, 0);
  const gh = github(view.headRefOid);

  const folder = path.join(sandbox.tmp, 'review-tour', `project-PR-7-since-${since}`);
  const old = sandbox.run(['comment', folder, 'a.txt', '1', '--side', 'old', '--body', 'Why?'], { cwd: world.clone.dir });

  assert.equal(old.status, 1);
  assert.match(old.stderr, /old side of this follow-up tour is the earlier head .*, not the pull request's base, so no comment was added/);
  assert.deepEqual(gh.log().filter((call) => call[0] === 'api'), []);

  const added = sandbox.run(['comment', folder, 'a.txt', '1', '--body', 'Why?'], { cwd: world.clone.dir });

  assert.equal(added.status, 0, added.stderr);
  assert.equal(gh.log().filter(isMutation).length, 1);
});
