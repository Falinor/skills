// The little formatting plan text may carry: `code`, [label](https://…)
// links, blank-line paragraphs and "- " lists. Everything else is escaped.
import { escape } from './html.ts';

/** `code` or [label](url), the url allowing one level of balanced parentheses. */
const token = /`([^`]+)`|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

export const isSafeUrl = (url: string) => url.startsWith('https://') && URL.canParse(url);

/** `text` with its first letter upper-cased the way `lang` does it. */
export const capitalize = (text: string, lang: string) => text.charAt(0).toLocaleUpperCase(lang) + text.slice(1);

export function linkTo(url: string, html: string): string {
  return `<a href="${escape(url)}" target="_blank" rel="noopener">${html}</a>`;
}

/** The urls of the [label](url) links in `text`. */
export function inlineUrls(text: string): string[] {
  return Array.from(text.matchAll(token), (match) => match[3]).filter((url): url is string => url !== undefined);
}

/** One line of plan text as HTML. */
export function inline(text: string): string {
  let html = '';
  let last = 0;
  for (const match of text.matchAll(token)) {
    html += escape(text.slice(last, match.index));
    const [whole, code, label, url] = match;
    if (code !== undefined) html += `<code>${escape(code)}</code>`;
    else if (isSafeUrl(url)) html += linkTo(url, escape(label));
    else html += escape(whole);
    last = match.index + whole.length;
  }
  return html + escape(text.slice(last));
}

/** Plan text as paragraphs and lists: blocks are separated by a blank line; a block of "- " lines is a list. */
export function blocks(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim());
      if (lines.every((line) => line.startsWith('- '))) {
        return `<ul>${lines.map((line) => `<li>${inline(line.slice(2))}</li>`).join('')}</ul>`;
      }
      return `<p>${inline(lines.join(' '))}</p>`;
    })
    .join('');
}
