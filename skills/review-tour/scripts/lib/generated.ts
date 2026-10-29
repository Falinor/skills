// Declared generated: files the repository marks as generated. A declaration
// is not a proof, and only the base's declarations count: a change could
// otherwise declare its own edits generated to keep them from the reviewer.
import { linguistGenerated, listRawEntries, readBlobs } from './git.ts';
import type { ChangedFile } from './work-folder.ts';

const absent = /^0+$/;

/** An `@generated` marker in the first lines. */
const hasHeader = (text: string | undefined) => text?.split('\n', 5).some((line) => line.includes('@generated')) ?? false;

/** `files` with who declares each generated: the base, or only this change. */
export function markGenerated(root: string, from: string, to: string, files: ChangedFile[]): ChangedFile[] {
  const entries = listRawEntries(root, from, to);
  const paths = files.flatMap((file) => (file.oldPath ? [file.oldPath, file.path] : [file.path]));
  const byBase = linguistGenerated(root, from, paths);
  const byChange = linguistGenerated(root, to, paths);
  const texts = files.flatMap((file, index) =>
    file.additions === null ? [] : [entries[index].oldBlob, entries[index].newBlob].filter((id) => !absent.test(id)),
  );
  const blobs = readBlobs(root, texts);

  return files.map((file, index) => {
    const { oldBlob, newBlob } = entries[index];
    const filePaths = file.oldPath ? [file.oldPath, file.path] : [file.path];
    if (filePaths.every((filePath) => byBase.has(filePath)) || hasHeader(blobs.get(oldBlob))) {
      return { ...file, generated: 'base' };
    }
    if (byChange.has(file.path) || hasHeader(blobs.get(newBlob))) return { ...file, generated: 'change' };
    return file;
  });
}
