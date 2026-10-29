// Mechanical proofs: tool evidence, never model judgement, that a file's
// change preserves behaviour. `prepare` computes them before the agent reads
// anything, so proven files never reach the agent.
import path from 'node:path';
import { hasDifftastic, sameSyntax } from './difftastic.ts';
import { listMoves, listRawEntries, readBlobs, type FileMoves, type RawEntry } from './git.ts';
import type { ChangedFile, Proof } from './work-folder.ts';

/** One changed file as the provers see it. */
type Candidate = { file: ChangedFile; entry: RawEntry };

/** The range under proof and its changed files, in patch order. */
type Range = { root: string; from: string; to: string; candidates: Candidate[] };

/** The indexes of the candidates a proof holds for. */
type Prover = (range: Range) => Set<number>;

const isRegular = (mode: string) => mode === '100644' || mode === '100755';

/** The file's path before and after the change; the same one unless it was renamed. */
const pathsOf = (entry: RawEntry) => [entry.oldPath ?? entry.path, entry.path];

/** A text file edited in place or renamed with edits, a regular file on both sides with its mode kept. */
const editedText = ({ file, entry }: Candidate) =>
  (entry.status === 'M' || entry.status.startsWith('R')) &&
  entry.oldBlob !== entry.newBlob &&
  file.additions !== null &&
  isRegular(entry.oldMode) &&
  entry.oldMode === entry.newMode;

/** Both versions of each entry's file, in one read. */
function readVersions(root: string, entries: RawEntry[]): { before: string; after: string }[] {
  const blobs = readBlobs(root, entries.flatMap((entry) => [entry.oldBlob, entry.newBlob]));
  return entries.map((entry) => ({ before: blobs.get(entry.oldBlob) as string, after: blobs.get(entry.newBlob) as string }));
}

/** Renamed at 100% similarity, mode unchanged. */
const pureRename: Prover = ({ candidates }) =>
  indexesWhere(candidates, ({ entry }) => entry.status === 'R100' && entry.oldMode === entry.newMode);

const extensionOf = (file: string) => path.extname(file).slice(1).toLowerCase();

// Programming languages where a moved definition keeps its meaning, outside
// top-level statements run for their side effects (a known residual hole).
// Styles, data, configuration and query files are never proven moved: where a
// rule or a setting sits changes what it does.
const codeLanguages = 'c h cc cpp cxx hh hpp hxx cs java kt kts go rs swift dart js mjs cjs jsx ts mts cts tsx'.split(' ');
const inCodeLanguage = (file: string) => codeLanguages.includes(extensionOf(file));

// Languages where whitespace at the edges of a line, and blank lines, carry
// no meaning outside multi-line string literals (a known residual hole).
// Anything else, Python, YAML, Makefiles, Markdown, shell or unknown, is never
// proven whitespace only.
const whitespaceFree = new Set([...codeLanguages, ...'json jsonc css scss less sql'.split(' ')]);
const inWhitespaceFreeLanguage = (file: string) => whitespaceFree.has(extensionOf(file));

/** The lines that remain once whitespace at line edges and blank lines are dropped; inner whitespace is kept. */
const significantLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.replace(/^[ \t\r\f\v]+|[ \t\r\f\v]+$/g, ''))
    .filter((line) => line !== '');

/** Only whitespace at line edges and blank lines differ, in a language where they mean nothing. */
const whitespaceOnly: Prover = ({ root, candidates }) => {
  const eligible = [
    ...indexesWhere(candidates, (candidate) => editedText(candidate) && pathsOf(candidate.entry).every(inWhitespaceFreeLanguage)),
  ];
  const versions = readVersions(root, eligible.map((index) => candidates[index].entry));
  return new Set(
    eligible.filter((_, at) => {
      const before = significantLines(versions[at].before);
      const after = significantLines(versions[at].after);
      return before.length === after.length && before.every((line, index) => line === after[index]);
    }),
  );
};

// A moved block must leave one file and land in a different one, once each,
// between files of a programming language. A block that also lands in its own
// file may be a reorder, and one that lands twice is a copy: both change
// behaviour, so they prove nothing.
const enclose = (lines: string[]) => `\n${lines.join('\n')}\n`;

/** How many times `block` occurs in `text`, overlaps included. */
function occurrences(text: string, block: string): number {
  let count = 0;
  for (let at = text.indexOf(block); at !== -1; at = text.indexOf(block, at + 1)) count++;
  return count;
}

/** Every changed line moved, each moved block removed once and added once, into or out of another code file. */
const pureMove: Prover = ({ root, from, to, candidates }) => {
  const moves = listMoves(root, from, to);
  const runsOf = moves.map((file) => file.runs.map((run) => ({ sign: run.sign, text: enclose(run.blocks.flat()) })));
  const isCode = candidates.map(({ entry }) => pathsOf(entry).every(inCodeLanguage));
  /** Where `block` occurs among the runs of sign `sign`, one file index per occurrence. */
  const foundIn = (sign: string, block: string) =>
    runsOf.flatMap((runs, index) =>
      runs.flatMap((run) => (run.sign === sign ? Array<number>(occurrences(run.text, block)).fill(index) : [])),
    );
  const movedOnly = ({ file, entry }: Candidate, { unmoved, runs }: FileMoves) =>
    unmoved === 0 &&
    runs.length > 0 &&
    file.additions !== null &&
    (entry.oldMode === entry.newMode || entry.status === 'A' || entry.status === 'D');
  return indexesWhere(
    candidates,
    (candidate, index) =>
      isCode[index] &&
      movedOnly(candidate, moves[index]) &&
      moves[index].runs.every(({ sign, blocks }) =>
        blocks.every((block) => {
          const text = enclose(block);
          const opposite = foundIn(sign === '+' ? '-' : '+', text);
          return (
            foundIn(sign, text).length === 1 && opposite.length === 1 && opposite[0] !== index && isCode[opposite[0]]
          );
        }),
      ),
  );
};

/** The name difftastic guesses a language from: the extension, else the whole file name (`Makefile`). */
const languageKey = (file: string) => path.extname(file).toLowerCase() || path.basename(file);

/** difftastic finds the syntax tree unchanged: a reflow or re-indentation in any language it parses. */
const syntaxIdentical: Prover = ({ root, candidates }) => {
  if (!hasDifftastic()) return new Set();
  const eligible = [
    ...indexesWhere(candidates, (candidate) => {
      const [before, after] = pathsOf(candidate.entry);
      return editedText(candidate) && languageKey(before) === languageKey(after);
    }),
  ];
  const versions = readVersions(root, eligible.map((index) => candidates[index].entry));
  // A rename is compared under its new name, so both versions parse as one language.
  const same = sameSyntax(eligible.map((index, at) => ({ name: path.basename(candidates[index].entry.path), ...versions[at] })));
  return new Set(eligible.filter((_, at) => same[at]));
};

function indexesWhere(candidates: Candidate[], holds: (candidate: Candidate, index: number) => boolean): Set<number> {
  return new Set(candidates.flatMap((candidate, index) => (holds(candidate, index) ? [index] : [])));
}

const provers: [Proof, Prover][] = [
  ['pure-move', pureMove],
  ['pure-rename', pureRename],
  ['whitespace-only', whitespaceOnly],
  ['syntax-identical', syntaxIdentical],
];

/** `files` with the proofs each one carries; `files` must list the range `from`..`to` in patch order. */
export function proveFiles(root: string, from: string, to: string, files: ChangedFile[]): ChangedFile[] {
  const entries = listRawEntries(root, from, to);
  const candidates = files.map((file, index) => ({ file, entry: entries[index] }));
  const found = provers.map(([proof, prove]) => [proof, prove({ root, from, to, candidates })] as const);
  return files.map((file, index) => {
    const proofs = found.filter(([, proven]) => proven.has(index)).map(([proof]) => proof);
    return proofs.length > 0 ? { ...file, proofs } : file;
  });
}
