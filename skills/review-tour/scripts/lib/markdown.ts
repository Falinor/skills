// The Markdown subset tour plan prose may use: code spans, bold, lists and
// https links. Every piece of text goes through `escape`, so raw HTML in the
// plan is shown as text and never reaches the page as markup.
import { escape } from './page.ts';

// Alternatives are tried left to right at each position, and a code span's
// content is never read as bold or as a link. Only https links are links.
const inlinePattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g;

const listItem = /^ {0,3}([-*]|\d+\.) +(.*)$/;

/** One run of prose: code spans, bold and https links. */
export function inlineMarkdown(text: string): string {
  let html = '';
  let rest = 0;
  for (const match of text.matchAll(inlinePattern)) {
    const [whole, code, bold, label, href] = match;
    html += escape(text.slice(rest, match.index));
    if (code !== undefined) html += `<code>${escape(code)}</code>`;
    else if (bold !== undefined) html += `<strong>${inlineMarkdown(bold)}</strong>`;
    else html += `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${inlineMarkdown(label)}</a>`;
    rest = match.index + whole.length;
  }
  return html + escape(text.slice(rest));
}

/** Prose: paragraphs and lists (`-`, `*` or `1.`) of inline Markdown, split by blank lines. */
export function markdown(text: string): string {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | undefined;
  const flush = () => {
    if (paragraph.length > 0) blocks.push(`<p>${inlineMarkdown(paragraph.join('\n'))}</p>`);
    if (list) {
      const items = list.items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('');
      blocks.push(`<${list.tag}>${items}</${list.tag}>`);
    }
    paragraph = [];
    list = undefined;
  };
  for (const line of text.split(/\r?\n/)) {
    const item = listItem.exec(line);
    if (line.trim() === '') {
      flush();
    } else if (item) {
      const tag = item[1].endsWith('.') ? 'ol' : 'ul';
      if (list?.tag !== tag) flush();
      list ??= { tag, items: [] };
      list.items.push(item[2]);
    } else if (list && /^\s/.test(line)) {
      // An indented line continues the list item above it.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      if (list) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks.join('');
}
