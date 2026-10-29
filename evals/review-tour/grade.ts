// Script graders for one eval run: they read the tour plan the agent left in
// the work folder and check it against the fixture, without any model.
// Prints one `pass` or `fail` line per grader; exits 1 when any fails.
//
// Usage: node evals/review-tour/grade.ts <work-folder>
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './fixture.ts';

const cli = path.join(import.meta.dirname, '../../skills/review-tour/scripts/review-tour.mjs');

type PlannedStep = { number: number; tier: unknown; files: string[]; unprovenMechanical: string[] };

type Run = { folder: string; steps: PlannedStep[]; changed: string[] | undefined };

/** Why the run fails the grader, or undefined when it passes. */
type Grader = { name: string; check: (run: Run) => string | undefined };

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

const paths = (value: unknown) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);

/** The plan's steps, read leniently: an agent's plan may be malformed, and every grader must still report. */
function stepsOf(plan: unknown): PlannedStep[] {
  const steps = typeof plan === 'object' && plan !== null && 'steps' in plan && Array.isArray(plan.steps) ? plan.steps : [];
  return steps.map((step: Record<string, unknown> | null, index) => ({
    number: index + 1,
    tier: step?.tier,
    files: paths(step?.files),
    unprovenMechanical: paths(step?.unprovenMechanical),
  }));
}

const stepsHolding = (steps: PlannedStep[], file: string) => steps.filter((step) => step.files.includes(file));

const failures = (reasons: string[]) => (reasons.length > 0 ? reasons.join('; ') : undefined);

const graders: Grader[] = [
  {
    name: 'the hidden change sits in core logic',
    check: ({ steps }) => {
      const file = fixture.hiddenChange;
      const holding = stepsHolding(steps, file);
      if (holding.length === 0) return `${file} is in no step`;
      return failures(
        holding.flatMap((step) => {
          if (step.tier !== 'core-logic') return [`${file} is in ${String(step.tier)} step ${step.number}`];
          if (step.unprovenMechanical.includes(file)) return [`${file} is flagged unproven mechanical in step ${step.number}`];
          return [];
        }),
      );
    },
  },
  {
    name: 'proven files sit in mechanical',
    check: ({ steps }) =>
      failures(
        fixture.mechanical.flatMap((file) => {
          const holding = stepsHolding(steps, file);
          if (holding.length === 0) return [`${file} is in no step`];
          return holding
            .filter((step) => step.tier !== 'mechanical')
            .map((step) => `${file} is in ${String(step.tier)} step ${step.number}`);
        }),
      ),
  },
  {
    name: 'every file appears exactly once',
    check: ({ steps, changed }) => {
      if (!changed) return 'no captured change: prepare never ran';
      const planned = steps.flatMap((step) => step.files);
      return failures([
        ...changed.flatMap((file) => {
          const holding = stepsHolding(steps, file).map((step) => step.number);
          if (holding.length === 0) return [`${file} is in no step`];
          return holding.length > 1 ? [`${file} is in steps ${holding.join(', ')}`] : [];
        }),
        ...[...new Set(planned.filter((file) => !changed.includes(file)))].map((file) => `${file} is not part of the change`),
      ]);
    },
  },
  {
    name: 'render succeeded and the page exists',
    check: ({ folder }) => {
      const page = path.join(folder, 'tour.html');
      if (!fs.existsSync(page)) return `no page at ${page}`;
      // The agent may have edited the plan after its last render: the final plan must render too.
      const result = spawnSync(process.execPath, [cli, 'render', folder], { encoding: 'utf8' });
      if (result.status === 0) return undefined;
      return `render rejects the final plan: ${result.stderr.trim().replace(/^review-tour: /, '').replace(/\n+/g, ' ')}`;
    },
  },
];

function grade(folder: string): boolean {
  const change = readJson(path.join(folder, 'change.json')) as { files?: { path: string }[] } | undefined;
  const run: Run = {
    folder,
    steps: stepsOf(readJson(path.join(folder, 'plan.json'))),
    changed: change?.files?.map((file) => file.path),
  };
  let passed = true;
  for (const { name, check } of graders) {
    const failure = check(run);
    passed &&= failure === undefined;
    console.log(failure === undefined ? `pass  ${name}` : `fail  ${name}: ${failure}`);
  }
  return passed;
}

if (import.meta.main) {
  const [folder] = process.argv.slice(2);
  if (!folder) {
    console.error('usage: node evals/review-tour/grade.ts <work-folder>');
    process.exit(2);
  }
  process.exitCode = grade(path.resolve(folder)) ? 0 : 1;
}
