// Cuts the captured patch into per-file diffs. The renderer shows these;
// the tour plan never carries diff text.
import { UserError } from './errors.ts';
import type { ChangedFile } from './work-folder.ts';

export type DiffLine = {
  kind: 'add' | 'del' | 'context' | 'note';
  oldNumber?: number;
  newNumber?: number;
  /** The line without its leading +, - or space. */
  text: string;
};

export type Hunk = { header: string; lines: DiffLine[] };

export type FileDiff = { file: ChangedFile; hunks: Hunk[]; binary: boolean };

/** The patch's `diff --git` sections, one per changed file, in the order of change.json's files. */
export function patchSections(patch: string): string[] {
  // Hunk lines always start with a prefix character, so `diff --git ` at the
  // start of a line can only open a file section. Sections come in the same
  // order as change.json's files: both come from identical diff flags.
  return patch.split(/^(?=diff --git )/m).filter((section) => section.startsWith('diff --git '));
}

/** One diff per changed file, keyed by path. */
export function cutPatch(patch: string, files: ChangedFile[]): Map<string, FileDiff> {
  const sections = patchSections(patch);
  if (sections.length !== files.length) {
    throw new UserError('change.patch does not match change.json; run prepare again.');
  }
  return new Map(files.map((file, index) => [file.path, parseSection(file, sections[index])]));
}

function parseSection(file: ChangedFile, section: string): FileDiff {
  const lines = section.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const hunks: Hunk[] = [];
  let binary = false;
  let oldNumber = 0;
  let newNumber = 0;
  for (const line of lines) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    const hunk = hunks.at(-1);
    if (header) {
      oldNumber = Number(header[1]);
      newNumber = Number(header[2]);
      hunks.push({ header: line, lines: [] });
    } else if (!hunk) {
      if (line.startsWith('Binary files ') || line === 'GIT binary patch') binary = true;
    } else if (line.startsWith('+')) {
      hunk.lines.push({ kind: 'add', newNumber: newNumber++, text: line.slice(1) });
    } else if (line.startsWith('-')) {
      hunk.lines.push({ kind: 'del', oldNumber: oldNumber++, text: line.slice(1) });
    } else if (line.startsWith('\\')) {
      hunk.lines.push({ kind: 'note', text: line });
    } else {
      hunk.lines.push({ kind: 'context', oldNumber: oldNumber++, newNumber: newNumber++, text: line.slice(1) });
    }
  }
  return { file, hunks, binary };
}
