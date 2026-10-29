// The per-tour work folder: the contract between `prepare`, the agent and
// `render`. It lives under the system temp directory, outside the checkout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UserError } from './errors.ts';

export type ChangedFile = {
  path: string;
  /** Set for renames and copies. */
  oldPath?: string;
  /** git's status letter: A, M, D, R, C, T. */
  status: string;
  /** null for binary files. */
  additions: number | null;
  deletions: number | null;
};

export type Change = {
  repository: string;
  target: string;
  base: string;
  mergeBase: string;
  head: string;
  files: ChangedFile[];
  /** Set when the target is a GitHub pull request. */
  pullRequest?: { number: number; url: string };
};

export const workFolderFiles = {
  change: 'change.json',
  patch: 'change.patch',
  plan: 'plan.json',
  page: 'tour.html',
} as const;

export function workFolderFor(repository: string, target: string): string {
  const name = `${repository}-${target}`.replace(/[^A-Za-z0-9._-]+/g, '-');
  return path.join(os.tmpdir(), 'review-tour', name);
}

/** Starts the folder afresh: a plan written for an earlier capture no longer applies. */
export function writeCapture(folder: string, change: Change, patch: string): void {
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, workFolderFiles.change), `${JSON.stringify(change, null, 2)}\n`);
  fs.writeFileSync(path.join(folder, workFolderFiles.patch), patch);
}

/** What `prepare` captured in `folder`. */
export function readCapture(folder: string): { change: Change; patch: string } {
  const changeFile = path.join(folder, workFolderFiles.change);
  if (!fs.existsSync(changeFile)) {
    throw new UserError(`${folder} holds no captured change; run prepare first.`);
  }
  return {
    change: JSON.parse(fs.readFileSync(changeFile, 'utf8')) as Change,
    patch: fs.readFileSync(path.join(folder, workFolderFiles.patch), 'utf8'),
  };
}
