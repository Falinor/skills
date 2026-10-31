// Syntax highlighting, done once at render so the page needs no script for
// it. Whole files are highlighted, so a comment or string that opens before a
// hunk still colours the hunk's lines. highlight.js escapes the code it
// returns; any line whose markup is not its spans and escaped text, or whose
// text differs from the diff's, falls back to plain escaped text.
import path from 'node:path';
import hljs from '../vendor/highlight.js/highlight.min.js';

/** Files larger than this stay plain: highlighting them would slow render for little gain. */
const maxLength = 512 * 1024;

const tokens = /<span class="[\w -]+">|<\/span>|[^<]+/g;

/** The language highlight.js knows for `file`, by extension (`ts`, `py`) or by name (`makefile`). */
function languageOf(file: string): string | undefined {
  const name = path.posix.basename(file).toLowerCase();
  return [path.posix.extname(name).slice(1), name].find((candidate) => candidate && hljs.getLanguage(candidate));
}

/** Highlighted HTML split per line, each line's spans closed at its end and reopened on the next. */
function splitLines(html: string): string[] | undefined {
  const lines: string[] = [];
  const open: string[] = [];
  let line = '';
  let length = 0;
  for (const [token] of html.matchAll(tokens)) {
    length += token.length;
    if (token.startsWith('<span')) {
      open.push(token);
      line += token;
    } else if (token === '</span>') {
      if (!open.pop()) return undefined;
      line += token;
    } else {
      const [first, ...rest] = token.split('\n');
      line += first;
      for (const text of rest) {
        lines.push(line + '</span>'.repeat(open.length));
        line = open.join('') + text;
      }
    }
  }
  // Anything the tokens left out is markup we don't expect.
  if (length !== html.length || open.length > 0) return undefined;
  lines.push(line);
  return lines;
}

const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'" };

/** The text a highlighted line shows. */
const textOf = (line: string) => line.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => entities[entity]);

/** Each line of `content` as HTML, indexed by line number from 1; undefined when the file can't be highlighted. */
export function highlightFile(file: string, content: string): (string | undefined)[] | undefined {
  const language = languageOf(file);
  if (!language || content.length > maxLength) return undefined;
  try {
    const lines = splitLines(hljs.highlight(content, { language, ignoreIllegals: true }).value);
    return lines && [undefined, ...lines];
  } catch {
    return undefined;
  }
}

/** `line` as highlighted HTML, when the highlighted file holds exactly that text there. */
export function highlightedLine(lines: (string | undefined)[] | undefined, number: number | undefined, text: string) {
  const html = number === undefined ? undefined : lines?.[number];
  return html !== undefined && textOf(html) === text ? html : undefined;
}
