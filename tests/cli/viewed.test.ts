import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fakeGh, pullRequestRepo, type GhAnswer } from '../support/github.ts';
import { makeSandbox, type Sandbox } from '../support/sandbox.ts';
import { prepareChange, writePlan } from '../support/tour.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.cleanup());

/**
 * Pull request #7, prepared and planned: step 1 a.txt, step 2 b.txt (core
 * logic), step 3 c.txt (wiring), step 4 new.txt (mechanical, a pure rename).
 */
function pullRequestTour() {
  const world = pullRequestRepo(sandbox, { 'a.txt': 'one\n', 'c.txt': 'c\n', 'old.txt': 'kept as is\n' });
  world.author.git('mv', 'old.txt', 'new.txt');
  world.author.write({ 'a.txt': 'two\n', 'b.txt': 'b\n', 'c.txt': 'cc\n' });
  world.author.commit('feature');
  const view = world.publish();
  fakeGh(sandbox, [{ args: ['pr', 'view'], stdout: view }]);
  const prepared = sandbox.run(['prepare', '7'], { cwd: world.clone.dir });
  assert.equal(prepared.status, 0, prepared.stderr);
  const folder = path.join(sandbox.tmp, 'review-tour', 'project-PR-7');
  writePlan(folder, {
    steps: [
      { title: 'A', files: ['a.txt'], explanation: '' },
      { title: 'B', files: ['b.txt'], explanation: '' },
      { title: 'C', tier: 'wiring', files: ['c.txt'], explanation: '' },
      { title: 'Renamed', tier: 'mechanical', files: ['new.txt'], explanation: '' },
    ],
  });
  return { ...world, folder, head: view.headRefOid };
}

type ViewedState = 'VIEWED' | 'UNVIEWED' | 'DISMISSED';

const unviewed: Record<string, ViewedState> = {
  'a.txt': 'UNVIEWED',
  'b.txt': 'UNVIEWED',
  'c.txt': 'UNVIEWED',
  'new.txt': 'UNVIEWED',
};

/** One page of the pull request's files as GitHub's GraphQL API answers it. */
function filesPage(head: string, states: Record<string, ViewedState>, endCursor: string | null = null) {
  return {
    data: {
      repository: {
        pullRequest: {
          id: 'PR_kw7',
          headRefOid: head,
          files: {
            pageInfo: { hasNextPage: endCursor !== null, endCursor },
            nodes: Object.entries(states).map(([file, viewerViewedState]) => ({ path: file, viewerViewedState })),
          },
        },
      },
    },
  };
}

/** A fake GitHub whose pull request is at `head` with these viewed states; `before` answers take precedence. */
function github(head: string, states: Record<string, ViewedState> = unviewed, before: GhAnswer[] = []) {
  return fakeGh(sandbox, [
    ...before,
    { args: ['api', 'graphql'], includes: 'markFileAsViewed', stdout: { data: {} } },
    { args: ['api', 'graphql'], includes: 'viewerViewedState', stdout: filesPage(head, states) },
  ]);
}

const isMarking = (call: string[]) => call.some((arg) => arg.includes('markFileAsViewed'));

/** The paths every markFileAsViewed call sent, in order. */
function ticked(log: string[][]): string[] {
  return log
    .filter(isMarking)
    .flatMap((call) => call.flatMap((arg, index) => (call[index - 1] === '-f' && /^p\d+=/.test(arg) ? [arg.slice(arg.indexOf('=') + 1)] : [])));
}

test("ticks a step's files as Viewed on the pull request and says which", () => {
  const tour = pullRequestTour();
  const gh = github(tour.head);

  const result = sandbox.run(['viewed', tour.folder, '2'], { cwd: tour.clone.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(ticked(gh.log()), ['b.txt']);
  const marking = gh.log().find(isMarking) ?? [];
  assert.ok(marking.includes('pr=PR_kw7'), 'marks files on the pull request GitHub named');
  assert.match(result.stdout, /^Ticked as Viewed on pull request #7: 1 file\n {2}b\.txt$/m);
});

test('ticks the files of a range of steps, a list of steps, or both', () => {
  const tour = pullRequestTour();

  for (const [selection, expected] of [
    ['1-3', ['a.txt', 'b.txt', 'c.txt']],
    ['1–2', ['a.txt', 'b.txt']],
    ['1,3', ['a.txt', 'c.txt']],
    ['4,1-2', ['new.txt', 'a.txt', 'b.txt']],
  ] as const) {
    const gh = github(tour.head);
    const before = ticked(gh.log()).length;

    const result = sandbox.run(['viewed', tour.folder, selection], { cwd: tour.clone.dir });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(ticked(gh.log()).slice(before), expected, selection);
  }
});

test('names the steps the tour lacks and calls GitHub for nothing', () => {
  const tour = pullRequestTour();
  const gh = github(tour.head);

  for (const selection of ['5', '0', '3-1', 'two', '2-9']) {
    const result = sandbox.run(['viewed', tour.folder, selection], { cwd: tour.clone.dir });

    assert.equal(result.status, 1, selection);
    assert.match(result.stderr, /review-tour viewed <work-folder>/, selection);
  }
  assert.match(sandbox.run(['viewed', tour.folder, '2-9'], { cwd: tour.clone.dir }).stderr, /the tour has 4 steps/);
  assert.deepEqual(gh.log().filter((call) => call[0] === 'api'), []);
});

const neverUnmarks = (log: string[][]) =>
  assert.ok(!log.flat().some((arg) => /unmarkFileAsViewed/i.test(arg)), 'never calls the unmark mutation');

test('reads every viewed state first, skips files already viewed and ticks files with new changes again', () => {
  const tour = pullRequestTour();
  const gh = github(tour.head, { 'a.txt': 'VIEWED', 'b.txt': 'DISMISSED', 'c.txt': 'UNVIEWED', 'new.txt': 'VIEWED' });

  const result = sandbox.run(['viewed', tour.folder, '1-3'], { cwd: tour.clone.dir });

  assert.equal(result.status, 0, result.stderr);
  const calls = gh.log().filter((call) => call[0] === 'api');
  assert.match(calls[0].join(' '), /viewerViewedState/, 'reads the viewed states before marking anything');
  assert.deepEqual(ticked(gh.log()), ['b.txt', 'c.txt']);
  assert.equal(calls.filter(isMarking).length, 1, 'one batch of marks');
  neverUnmarks(gh.log());
  assert.match(result.stdout, /^Ticked as Viewed on pull request #7: 2 files\n {2}b\.txt\n {2}c\.txt$/m);
  assert.match(result.stdout, /^Already viewed, left as they were: 1 file\n {2}a\.txt$/m);
});

test('marks nothing when every chosen file is already viewed', () => {
  const tour = pullRequestTour();
  const gh = github(tour.head, { ...unviewed, 'a.txt': 'VIEWED' });

  const result = sandbox.run(['viewed', tour.folder, '1'], { cwd: tour.clone.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(gh.log().filter(isMarking), []);
  neverUnmarks(gh.log());
  assert.match(result.stdout, /^Nothing to tick on pull request #7\.$/m);
  assert.match(result.stdout, /^Already viewed, left as they were: 1 file\n {2}a\.txt$/m);
});

test('refuses a stale tour, ticking nothing, and suggests a follow-up tour', () => {
  const tour = pullRequestTour();
  const moved = 'f'.repeat(40);
  const gh = github(moved);

  const result = sandbox.run(['viewed', tour.folder, '1-4'], { cwd: tour.clone.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /the tour is stale/);
  assert.match(result.stderr, new RegExp(`moved from the toured head ${tour.head.slice(0, 12)} to ffffffffffff, so nothing was ticked`));
  assert.match(result.stderr, new RegExp(`follow-up tour.*: /review-tour 7 since ${tour.head}`));
  assert.deepEqual(gh.log().filter(isMarking), []);
  neverUnmarks(gh.log());
});

test('refuses a local-branch tour without calling GitHub', () => {
  const { folder, repo } = prepareChange(sandbox, { trunk: { 'a.txt': 'one\n' }, feature: { 'a.txt': 'two\n' } });
  writePlan(folder, { steps: [{ title: 'A', files: ['a.txt'], explanation: '' }] });
  const gh = fakeGh(sandbox, []);

  const result = sandbox.run(['viewed', folder, '1'], { cwd: repo.dir });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /local branch feature, which has no pull request on GitHub, so nothing was ticked/);
  assert.deepEqual(gh.log(), []);
});

test("reads every page of the pull request's files before ticking", () => {
  const tour = pullRequestTour();
  const gh = fakeGh(sandbox, [
    { args: ['api', 'graphql'], includes: '"page-2"', stdout: filesPage(tour.head, { 'b.txt': 'UNVIEWED', 'c.txt': 'VIEWED' }) },
    { args: ['api', 'graphql'], includes: 'markFileAsViewed', stdout: { data: {} } },
    { args: ['api', 'graphql'], includes: 'viewerViewedState', stdout: filesPage(tour.head, { 'a.txt': 'UNVIEWED' }, 'page-2') },
  ]);

  const result = sandbox.run(['viewed', tour.folder, '1-3'], { cwd: tour.clone.dir });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(ticked(gh.log()), ['a.txt', 'b.txt']);
  assert.match(result.stdout, /^Already viewed, left as they were: 1 file\n {2}c\.txt$/m);
});
