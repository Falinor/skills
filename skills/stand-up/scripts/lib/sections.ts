// The three sections as the page and the chat present them.
import { dateRange, daysBetween, longDate, shortDate, weekday } from './dates.ts';
import type { Labels } from './labels.ts';
import { sectionKeys, type Group, type Plan, type SectionKey } from './plan.ts';
import { capitalize } from './text.ts';
import type { Context } from './work-folder.ts';

export type Section = { key: SectionKey; title: string; when: string; groups: Group[] };

/** The first section's heading, by how far back it starts: yesterday, a weekday this week, or a date beyond. */
function sinceHeading(labels: Labels, { since, today, lang }: Context): string {
  const distance = daysBetween(since, today);
  if (distance === 1) return labels.yesterday;
  if (distance < 7) return capitalize(weekday(since, lang), lang);
  return `${labels.since} ${shortDate(since, lang)}`;
}

export function sectionsOf(plan: Plan, labels: Labels, context: Context): Section[] {
  const titles: Record<SectionKey, string> = {
    yesterday: sinceHeading(labels, context),
    today: labels.today,
    blockers: labels.blockers,
  };
  const when: Record<SectionKey, string> = {
    yesterday: dateRange(context.since, context.until, context.lang),
    today: longDate(context.today, context.lang),
    blockers: '',
  };
  return sectionKeys.map((key) => ({ key, title: titles[key], when: when[key], groups: plan[key] }));
}
