// What the chat shows once the page is written: the intent, then each step
// with its #step-N link. Plan text loses its control characters so it can't
// drive the reviewer's terminal.
import { doors, type TourPlan } from './plan.ts';

const printable = (text: string) => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const oneLine = (text: string) => printable(text).replace(/\s+/g, ' ').trim();

/** Markdown the agent relays as is: the intent and the step list, linked into the page. */
export function handover(plan: TourPlan, pageUrl: string): string {
  const { why, visual, mergeDanger } = plan.intent;
  const block = printable(visual.trimEnd());
  const fence = '`'.repeat(Math.max(3, ...Array.from(block.matchAll(/`+/g), ([run]) => run.length + 1)));
  return [
    '## Intent',
    '',
    printable(why.trim()),
    '',
    `${fence}text`,
    block,
    fence,
    '',
    `Merge danger: ${doors[mergeDanger.door]}, blast radius: ${oneLine(mergeDanger.blastRadius)}`,
    '',
    '## Steps',
    '',
    ...plan.steps.map((step, index) => `${index + 1}. ${oneLine(step.title)}: ${pageUrl}#step-${index + 1}`),
  ].join('\n');
}
