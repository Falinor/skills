// Declared generated: files the repository marks as generated. A declaration
// is not a proof, and only the base's declarations count: a change could
// otherwise declare its own edits generated to keep them from the reviewer.
import { linguistGenerated, listRawEntries, readBlobs } from './git.ts';
import type { ChangedFile } from './work-folder.ts';

const absent = /^0+$/;

/** An `@generated` marker in the first lines. */
const hasHeader = (text: string | undefined) => text?.split('\n', 5).some((line) => line.includes('@generated')) ?? false;

/**
 * `files` (the range `from`..`to` in patch order) with who declares each
 * generated: the base, read at `mergeBase` whatever `from` is, or only the
 * change, read at `to`.
 */
export function markGenerated(root: string, mergeBase: string, from: string, to: string, files: ChangedFile[]): ChangedFile[] {
  const entries = listRawEntries(root, from, to);
  const pathsOf = (file: ChangedFile) => (file.oldPath ? [file.oldPath, file.path] : [file.path]);
  const byBase = linguistGenerated(root, mergeBase, files.flatMap(pathsOf));
  const byChange = linguistGenerated(root, to, files.map((file) => file.path));
  // The base's version of a file is the one at the merge base, under its old path.
  const baseNames = files.map((file) => `${mergeBase}:${file.oldPath ?? file.path}`);
  const texts = files.flatMap((file, index) =>
    file.additions === null ? [] : [baseNames[index], entries[index].newBlob].filter((name) => !absent.test(name)),
  );
  const blobs = readBlobs(root, texts);

  return files.map((file, index) => {
    if (pathsOf(file).every((filePath) => byBase.has(filePath)) || hasHeader(blobs.get(baseNames[index]))) {
      return { ...file, generated: 'base' };
    }
    if (byChange.has(file.path) || hasHeader(blobs.get(entries[index].newBlob))) return { ...file, generated: 'change' };
    return file;
  });
}
