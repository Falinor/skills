// The three sections as the page and the chat present them.
import { addDays, formatDay, longDate, parseDay } from './dates.ts';
import type { Labels } from './labels.ts';
import { sectionKeys, type Group, type Plan, type SectionKey } from './plan.ts';
import type { Context } from './work-folder.ts';

export type Section = { key: SectionKey; title: string; when: string; groups: Group[] };

export function sectionsOf(plan: Plan, labels: Labels, context: Context): Section[] {
  const yesterday = formatDay(addDays(parseDay(context.today)!, -1));
  const titles: Record<SectionKey, string> = {
    yesterday: context.since === yesterday ? labels.yesterday : labels.since,
    today: labels.today,
    blockers: labels.blockers,
  };
  const when: Record<SectionKey, string> = {
    yesterday: longDate(context.since, context.lang),
    today: longDate(context.today, context.lang),
    blockers: '',
  };
  return sectionKeys.map((key) => ({ key, title: titles[key], when: when[key], groups: plan[key] }));
}
