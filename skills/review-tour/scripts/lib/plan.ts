// The tour plan: what the agent writes into the work folder. It never
// contains diff text; the renderer cuts diffs from the captured patch.
import { UserError } from './errors.ts';
import type { FileDiff } from './patch.ts';
import { mayBeMechanical, type Change } from './work-folder.ts';

/** Tiers in the order a tour presents them. */
export const tiers = ['core-logic', 'wiring', 'mechanical'] as const;
export type Tier = (typeof tiers)[number];

export const tierLabels: Record<Tier, string> = {
  'core-logic': 'Core logic',
  wiring: 'Wiring',
  mechanical: 'Mechanical',
};

export const calloutTags = ['Subtle', 'Breaking', 'Security', 'Perf', 'Concurrency', 'One-way door'] as const;

/** One concrete input followed through the old and the new code, one entry per point of the run. */
export type Trace = { input: string; old: string[]; new: string[] };

/** A tagged warning anchored to one line of a file's diff, on its old or new side. */
export type Callout = { file: string; line: number; side: 'old' | 'new'; tag: string; text: string };

export type Step = {
  title: string;
  tier: Tier;
  files: string[];
  /** Files the agent believes mechanical but that carry no proof; only core-logic steps hold them. */
  unprovenMechanical?: string[];
  explanation: string;
  /** Reviewer questions: what the reviewer should answer from their own knowledge. */
  questions?: string[];
  callouts?: Callout[];
  /** Plain-text pseudocode for dense logic, shown as written. */
  pseudocode?: string;
  /** For surprising behaviour changes: where the old and new runs part ways. */
  trace?: Trace;
};

/** The opening of a tour: why the change exists, one visual of its shape, and its merge danger. */
export type Intent = {
  why: string;
  visual: string;
  mergeDanger: { door: 'one-way' | 'two-way'; blastRadius: string };
};

export type TourPlan = { intent: Intent; steps: Step[] };

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

const listTags = `${calloutTags.slice(0, -1).join(', ')} or ${calloutTags.at(-1)}`;

/** Whether `diff` shows `line` on `side`, as an added, removed or context line. */
function showsLine(diff: FileDiff, side: Callout['side'], line: number): boolean {
  return diff.hunks.some((hunk) =>
    hunk.lines.some((shown) => (side === 'old' ? shown.oldNumber : shown.newNumber) === line),
  );
}

/** Why the callout's anchor is not a line its file's diff shows on that side, if it is not. */
function misplacedAnchor({ file, line, side }: Callout, diff: FileDiff): string | undefined {
  if (showsLine(diff, side, line)) return undefined;
  const other = side === 'old' ? 'new' : 'old';
  return showsLine(diff, other, line)
    ? `line ${line} of ${file} is on the ${other} side, not the ${side}`
    : `${side} line ${line} of ${file} is outside every hunk`;
}

/** Every callout carries a known tag and sits on a line its step's diff shows, on the side it names. */
function checkCallouts(plan: TourPlan, _change: Change, diffs: Map<string, FileDiff>): string[] {
  return plan.steps.flatMap((step, stepIndex) =>
    (step.callouts ?? []).flatMap((callout, index) => {
      const at = `step ${stepIndex + 1}, callout ${index + 1}`;
      const violations: string[] = [];
      if (!(calloutTags as readonly string[]).includes(callout.tag)) {
        violations.push(`${at}: unknown tag "${callout.tag}"; use ${listTags}`);
      }
      const diff = diffs.get(callout.file);
      const misplaced = diff && misplacedAnchor(callout, diff);
      if (!step.files.includes(callout.file)) violations.push(`${at}: ${callout.file} is not in this step`);
      else if (misplaced) violations.push(`${at}: ${misplaced}`);
      return violations;
    }),
  );
}

/** Steps run core logic, then wiring, then mechanical. */
function checkTierOrder(plan: TourPlan): string[] {
  return plan.steps.flatMap((step, index) => {
    const later = plan.steps.slice(0, index).find((earlier) => tiers.indexOf(earlier.tier) > tiers.indexOf(step.tier));
    return later
      ? [`step ${index + 1} (${step.tier}) comes after a ${later.tier} step; order steps ${tiers.join(', then ')}`]
      : [];
  });
}

/** Only proven or base-declared generated files sit in the mechanical tier; unproven ones stay in core logic, flagged. */
function checkMechanical(plan: TourPlan, change: Change): string[] {
  const byPath = new Map(change.files.map((file) => [file.path, file]));
  return plan.steps.flatMap((step, index) => {
    const at = `step ${index + 1}`;
    const violations: string[] = [];
    if (step.tier === 'mechanical') {
      for (const file of step.files) {
        const changed = byPath.get(file);
        if (changed && !mayBeMechanical(changed)) {
          violations.push(
            `${at}: ${file} has no mechanical proof; move it to a core-logic step and list it in "unprovenMechanical"`,
          );
        }
      }
    }
    for (const file of step.unprovenMechanical ?? []) {
      if (!step.files.includes(file)) violations.push(`${at}: ${file} is flagged unproven mechanical but is not in this step`);
      else if (step.tier !== 'core-logic') {
        violations.push(`${at}: ${file} is flagged unproven mechanical, which only core-logic steps hold`);
      }
    }
    return violations;
  });
}

type Rule = (plan: TourPlan, change: Change, diffs: Map<string, FileDiff>) => string[];

/** Rules checked once the plan is well formed. */
const rules: Rule[] = [checkCoverage, checkCallouts, checkTierOrder, checkMechanical];

const isText = (value: unknown): value is string => typeof value === 'string';
const isFilled = (value: unknown): value is string => isText(value) && value.trim() !== '';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);

function checkCalloutShape(callout: unknown, at: string): string[] {
  if (!isRecord(callout)) return [`${at} must be an object`];
  const violations: string[] = [];
  if (!isText(callout.file)) violations.push(`${at}: "file" must be text`);
  if (!Number.isInteger(callout.line) || (callout.line as number) < 1) {
    violations.push(`${at}: "line" must be a line number`);
  }
  if (callout.side !== 'old' && callout.side !== 'new') violations.push(`${at}: "side" must be "old" or "new"`);
  if (!isText(callout.tag)) violations.push(`${at}: "tag" must be text`);
  if (!isText(callout.text)) violations.push(`${at}: "text" must be text`);
  return violations;
}

/** Reading aids are optional; when present they must be well formed. */
function checkAidsShape(step: Record<string, unknown>, at: string): string[] {
  const { questions, pseudocode, trace, callouts } = step;
  const violations: string[] = [];
  if (questions !== undefined && !isTextList(questions)) violations.push(`${at}: "questions" must be a list of text`);
  if (pseudocode !== undefined && !isText(pseudocode)) violations.push(`${at}: "pseudocode" must be text`);
  if (
    trace !== undefined &&
    !(isRecord(trace) && isText(trace.input) && isTextList(trace.old) && isTextList(trace.new))
  ) {
    violations.push(`${at}: "trace" must have text "input" and lists of text "old" and "new"`);
  }
  if (callouts !== undefined && !Array.isArray(callouts)) violations.push(`${at}: "callouts" must be a list`);
  if (Array.isArray(callouts)) {
    violations.push(...callouts.flatMap((callout, index) => checkCalloutShape(callout, `${at}, callout ${index + 1}`)));
  }
  return violations;
}

function checkShape(raw: unknown): string[] {
  if (!isRecord(raw) || !Array.isArray(raw.steps)) return ['the plan must be an object with a "steps" list'];
  return raw.steps.flatMap((step: unknown, index) => {
    const at = `step ${index + 1}`;
    if (!isRecord(step)) return [`${at} must be an object`];
    const violations: string[] = [];
    if (!isText(step.title)) violations.push(`${at}: "title" must be text`);
    if (!tiers.includes(step.tier as Tier)) violations.push(`${at}: "tier" must be one of ${tiers.join(', ')}`);
    if (!Array.isArray(step.files) || !step.files.every(isText)) {
      violations.push(`${at}: "files" must be a list of paths`);
    }
    if (step.unprovenMechanical !== undefined && !(Array.isArray(step.unprovenMechanical) && step.unprovenMechanical.every(isText))) {
      violations.push(`${at}: "unprovenMechanical" must be a list of paths`);
    }
    if (!isText(step.explanation)) violations.push(`${at}: "explanation" must be text`);
    violations.push(...checkAidsShape(step, at));
    return violations;
  });
}

function checkIntent(raw: unknown): string[] {
  if (!isRecord(raw)) return [];
  if (raw.intent === undefined) {
    return ['"intent" is missing: the tour opens with why the change exists, one visual and its merge danger'];
  }
  const intent = raw.intent;
  if (!isRecord(intent)) return ['"intent" must be an object with "why", "visual" and "mergeDanger"'];
  const violations: string[] = [];
  if (!isFilled(intent.why)) violations.push('intent: "why" must be text');
  else {
    const lines = intent.why.trim().split('\n').length;
    if (lines > 3) violations.push(`intent: "why" has ${lines} lines; keep it to three at most`);
  }
  if (!isFilled(intent.visual)) violations.push('intent: "visual" must be text');
  const danger = isRecord(intent.mergeDanger) ? intent.mergeDanger : {};
  if (danger.door !== 'one-way' && danger.door !== 'two-way') {
    violations.push('intent: "mergeDanger.door" must be "one-way" or "two-way"');
  }
  if (!isFilled(danger.blastRadius)) violations.push('intent: "mergeDanger.blastRadius" must be text');
  return violations;
}

/** The plan, once it is well formed and obeys every rule; otherwise stops with every violation. */
export function validatePlan(raw: unknown, change: Change, diffs: Map<string, FileDiff>): TourPlan {
  const shape = [...checkIntent(raw), ...checkShape(raw)];
  const violations = shape.length > 0 ? shape : rules.flatMap((rule) => rule(raw as TourPlan, change, diffs));
  if (violations.length > 0) {
    throw new UserError(`the tour plan is invalid:\n${violations.map((violation) => `- ${violation}`).join('\n')}`);
  }
  return raw as TourPlan;
}
