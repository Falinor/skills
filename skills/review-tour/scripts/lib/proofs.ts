// Mechanical proofs: tool evidence, never model judgement, that a file's
// change preserves behaviour. `prepare` computes them before the agent reads
// anything, so proven files never reach the agent.
import path from 'node:path';
import { listRawEntries, readBlobs, type RawEntry } from './git.ts';
import type { ChangedFile, Proof } from './work-folder.ts';

/** One changed file as the provers see it. */
type Candidate = { file: ChangedFile; entry: RawEntry };

/** The indexes of the candidates a proof holds for. */
type Prover = (root: string, candidates: Candidate[]) => Set<number>;

const isRegular = (mode: string) => mode === '100644' || mode === '100755';

/** Renamed at 100% similarity, mode unchanged. */
const pureRename: Prover = (_root, candidates) =>
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
const whitespaceOnly: Prover = (root, candidates) => {
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

function indexesWhere(candidates: Candidate[], holds: (candidate: Candidate) => boolean): Set<number> {
  return new Set(candidates.flatMap((candidate, index) => (holds(candidate) ? [index] : [])));
}

const provers: [Proof, Prover][] = [
  ['pure-rename', pureRename],
  ['whitespace-only', whitespaceOnly],
];

/** `files` with the proofs each one carries; `files` must list the range `from`..`to` in patch order. */
export function proveFiles(root: string, from: string, to: string, files: ChangedFile[]): ChangedFile[] {
  const entries = listRawEntries(root, from, to);
  const candidates = files.map((file, index) => ({ file, entry: entries[index] }));
  const found = provers.map(([proof, prove]) => [proof, prove(root, candidates)] as const);
  return files.map((file, index) => {
    const proofs = found.filter(([, proven]) => proven.has(index)).map(([proof]) => proof);
    return proofs.length > 0 ? { ...file, proofs } : file;
  });
}
