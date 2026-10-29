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

/** Renamed at 100% similarity, mode unchanged. */
const pureRename: Prover = ({ candidates }) =>
  indexesWhere(candidates, ({ entry }) => entry.status === 'R100' && entry.oldMode === entry.newMode);

// Languages where whitespace at the edges of a line, and blank lines, carry
// no meaning outside multi-line string literals (a known residual hole).
// Anything else, Python, YAML, Makefiles, Markdown, shell or unknown, is never
// proven whitespace only.
const whitespaceFree = new Set(
  'c h cc cpp cxx hh hpp hxx cs java kt kts go rs swift dart js mjs cjs jsx ts mts cts tsx json jsonc css scss less sql'.split(' '),
);
const inWhitespaceFreeLanguage = (file: string) => whitespaceFree.has(path.extname(file).slice(1).toLowerCase());

/** The lines that remain once whitespace at line edges and blank lines are dropped; inner whitespace is kept. */
const significantLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.replace(/^[ \t\r\f\v]+|[ \t\r\f\v]+$/g, ''))
    .filter((line) => line !== '');

/** Only whitespace at line edges and blank lines differ, in a language where they mean nothing. */
const whitespaceOnly: Prover = ({ root, candidates }) => {
  const eligible = indexesWhere(
    candidates,
    ({ file, entry }) =>
      (entry.status === 'M' || entry.status.startsWith('R')) &&
      entry.oldBlob !== entry.newBlob &&
      file.additions !== null &&
      isRegular(entry.oldMode) &&
      entry.oldMode === entry.newMode &&
      [entry.oldPath ?? entry.path, entry.path].every(inWhitespaceFreeLanguage),
  );
  const blobs = readBlobs(root, [...eligible].flatMap((index) => [candidates[index].entry.oldBlob, candidates[index].entry.newBlob]));
  return new Set(
    [...eligible].filter((index) => {
      const before = significantLines(blobs.get(candidates[index].entry.oldBlob) as string);
      const after = significantLines(blobs.get(candidates[index].entry.newBlob) as string);
      return before.length === after.length && before.every((line, at) => line === after[at]);
    }),
  );
};

// A moved block must leave one file and land in a different one. A block
// that also lands in its own file may be a reorder, which changes behaviour,
// so it proves nothing, even when the same lines also move elsewhere.
const enclose = (lines: string[]) => `\n${lines.join('\n')}\n`;

/** Every changed line moved, each moved block found in another file's opposite runs and in none of its own. */
const pureMove: Prover = ({ root, from, to, candidates }) => {
  const moves = listMoves(root, from, to);
  const runsOf = moves.map((file) => file.runs.map((run) => ({ sign: run.sign, text: enclose(run.blocks.flat()) })));
  const landsIn = (index: number, sign: string, block: string) =>
    runsOf[index].some((run) => run.sign !== sign && run.text.includes(block));
  const movedOnly = ({ file, entry }: Candidate, { unmoved, runs }: FileMoves) =>
    unmoved === 0 &&
    runs.length > 0 &&
    file.additions !== null &&
    (entry.oldMode === entry.newMode || entry.status === 'A' || entry.status === 'D');
  return indexesWhere(
    candidates,
    (candidate, index) =>
      movedOnly(candidate, moves[index]) &&
      moves[index].runs.every(({ sign, blocks }) =>
        blocks.every((block) => {
          const text = enclose(block);
          return !landsIn(index, sign, text) && moves.some((_, other) => other !== index && landsIn(other, sign, text));
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
    ...indexesWhere(
      candidates,
      ({ file, entry }) =>
        (entry.status === 'M' ||
          (entry.status.startsWith('R') && languageKey(entry.oldPath ?? entry.path) === languageKey(entry.path))) &&
        entry.oldBlob !== entry.newBlob &&
        file.additions !== null &&
        isRegular(entry.oldMode) &&
        entry.oldMode === entry.newMode,
    ),
  ];
  const blobs = readBlobs(root, eligible.flatMap((index) => [candidates[index].entry.oldBlob, candidates[index].entry.newBlob]));
  // A rename is compared under its new name, so both versions parse as one language.
  const same = sameSyntax(
    eligible.map((index) => {
      const { entry } = candidates[index];
      return { name: path.basename(entry.path), before: blobs.get(entry.oldBlob) as string, after: blobs.get(entry.newBlob) as string };
    }),
  );
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
