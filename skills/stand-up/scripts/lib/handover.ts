// What the chat shows once the page is written: each section's items with
// their #id link. Plan text loses its control characters so it can't drive
// the user's terminal.
import type { Labels } from './labels.ts';
import type { Section } from './sections.ts';

const oneLine = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim();

/** Markdown the agent relays as is. */
export function handover(sections: Section[], labels: Labels, pageUrl: string): string {
  return sections
    .map((section) => {
      const items = section.groups.flatMap((group) => group.items);
      const lines = items.length ? items.map((item) => `- ${oneLine(item.title)}: ${pageUrl}#${item.id}`) : [`- ${labels.nothing}`];
      return [`## ${section.title}`, '', ...lines].join('\n');
    })
    .join('\n\n');
}
