// The tour plan: what the agent writes into the work folder. It never
// contains diff text; the renderer cuts diffs from the captured patch.
import { UserError } from './errors.ts';
import type { Change } from './work-folder.ts';

export type Step = {
  title: string;
  files: string[];
  explanation: string;
};

export type TourPlan = { steps: Step[] };

function listSteps(numbers: number[]): string {
  return `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
}

/** Every file of the change sits in exactly one step, and nothing else does. */
function checkCoverage(plan: TourPlan, change: Change): string[] {
  const stepsOf = new Map<string, number[]>(change.files.map((file) => [file.path, []]));
  const violations: string[] = [];
  plan.steps.forEach((step, index) => {
    for (const file of step.files) {
      const steps = stepsOf.get(file);
      if (steps) steps.push(index + 1);
      else violations.push(`${file} is not part of the change (step ${index + 1})`);
    }
  });
  for (const [file, steps] of stepsOf) {
    if (steps.length === 0) violations.push(`${file} is in no step`);
    if (steps.length > 1) violations.push(`${file} is in steps ${listSteps(steps)}`);
  }
  return violations;
}

type Rule = (plan: TourPlan, change: Change) => string[];

/** Rules checked once the plan is well formed. */
const rules: Rule[] = [checkCoverage];

const isText = (value: unknown): value is string => typeof value === 'string';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function checkShape(raw: unknown): string[] {
  if (!isRecord(raw) || !Array.isArray(raw.steps)) return ['the plan must be an object with a "steps" list'];
  return raw.steps.flatMap((step: unknown, index) => {
    const at = `step ${index + 1}`;
    if (!isRecord(step)) return [`${at} must be an object`];
    const violations: string[] = [];
    if (!isText(step.title)) violations.push(`${at}: "title" must be text`);
    if (!Array.isArray(step.files) || !step.files.every(isText)) {
      violations.push(`${at}: "files" must be a list of paths`);
    }
    if (!isText(step.explanation)) violations.push(`${at}: "explanation" must be text`);
    return violations;
  });
}

/** The plan, once it is well formed and obeys every rule; otherwise stops with every violation. */
export function validatePlan(raw: unknown, change: Change): TourPlan {
  const shape = checkShape(raw);
  const violations = shape.length > 0 ? shape : rules.flatMap((rule) => rule(raw as TourPlan, change));
  if (violations.length > 0) {
    throw new UserError(`the tour plan is invalid:\n${violations.map((violation) => `- ${violation}`).join('\n')}`);
  }
  return raw as TourPlan;
}
