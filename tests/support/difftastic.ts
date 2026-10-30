// difftastic for tests: a fake `difft` that answers like the real one, and
// where the real one is when it is installed (CI installs it).
import fs from 'node:fs';
import path from 'node:path';
import type { Sandbox } from './sandbox.ts';

/**
 * Puts a fake `difft` on the CLI's PATH, answering like difftastic 0.71: with
 * `--exit-code` it exits 1 on a syntactic change (without it, always 0), and
 * 2 when a file can't be read. It "parses" `.ts` and `.js` files as tokens
 * (string literals, words, punctuation), so their whitespace doesn't count; any
 * other file it compares byte for byte, as difftastic does for a language it
 * can't parse. Like the real one, `DFT_IGNORE_COMMENTS` makes it ignore comments.
 */
export function fakeDifft(sandbox: Sandbox) {
  return sandbox.fake(
    'difft',
    `const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('Difftastic 0.71.0'); process.exit(0); }
const [before, after] = args.slice(-2).map((file) => {
  try { return { file, text: fs.readFileSync(file, 'latin1') }; } catch { process.exit(2); }
});
const parsed = ({ file, text }) => {
  if (!/\\.(ts|js)$/.test(file)) return [text];
  if (process.env.DFT_IGNORE_COMMENTS) text = text.replace(/\\/\\/.*$/gm, '');
  return text.match(/(["'\`])(?:\\\\.|(?!\\1)[^\\\\])*\\1|[A-Za-z0-9_$]+|\\S/g) ?? [];
};
const changed = JSON.stringify(parsed(before)) !== JSON.stringify(parsed(after));
console.log(after.file + ' --- ' + (changed ? 'Has syntactic changes.' : 'No syntactic changes.'));
process.exit(changed && args.includes('--exit-code') ? 1 : 0);
`,
  );
}

/** The PATH directory holding the real `difft`, if it is installed. */
export const realDifftDir = (process.env.PATH ?? '')
  .split(path.delimiter)
  .find((dir) => dir !== '' && fs.existsSync(path.join(dir, 'difft')));
