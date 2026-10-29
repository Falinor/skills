// The per-tour work folder: the contract between `prepare`, the agent and
// `render`. It lives under the system temp directory, outside the checkout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UserError } from './errors.ts';

/** git's status letter: added, copied, deleted, modified, renamed, type changed, unmerged, unknown. */
export type FileStatus = 'A' | 'C' | 'D' | 'M' | 'R' | 'T' | 'U' | 'X';

export type ChangedFile = {
  path: string;
  /** Set for renames and copies. */
  oldPath?: string;
  status: FileStatus;
  /** null for binary files. */
  additions: number | null;
  deletions: number | null;
  /** Mechanical proofs found by `prepare`; absent when there are none. */
  proofs?: Proof[];
  /** Who declares the file generated: the base (trusted, listed apart) or this change (read like any other file). */
  generated?: 'base' | 'change';
};

/** Tool evidence that a file's change preserves behaviour. */
export type Proof = 'pure-move' | 'pure-rename' | 'whitespace-only' | 'syntax-identical';

export const proofLabels: Record<Proof, string> = {
  'pure-move': 'pure move',
  'pure-rename': 'pure rename',
  'whitespace-only': 'whitespace only',
  'syntax-identical': 'syntax-identical',
};

/** The file carries at least one mechanical proof. */
export function isProven(file: ChangedFile): boolean {
  return (file.proofs?.length ?? 0) > 0;
}

/** The file's proofs as the reviewer reads them: `pure rename, whitespace only`. */
export function describeProofs(file: ChangedFile): string {
  return (file.proofs ?? []).map((proof) => proofLabels[proof]).join(', ');
}

/** A file may sit in the mechanical tier only with a proof, or when the base declares it generated. */
export function mayBeMechanical(file: ChangedFile): boolean {
  return isProven(file) || file.generated === 'base';
}

export type Change = {
  repository: string;
  target: string;
  base: string;
  mergeBase: string;
  head: string;
  files: ChangedFile[];
  /** Set when the target is a GitHub pull request. */
  pullRequest?: { number: number; url: string };
  /** Set for a follow-up tour. */
  followUp?: FollowUp;
};

/** A follow-up tour: what changed since an earlier tour's head. */
export type FollowUp = {
  /** The earlier tour's head, as the reviewer gave it. */
  since: string;
  /** Where the captured patch starts (a commit or a tree); absent when the tour covers the full change. */
  from?: string;
  /** Set when `from` is the earlier head's tree replayed onto the new merge base: the base was merged in since. */
  replayed?: boolean;
  /** Why the tour covers the full change; set exactly when `from` is absent. */
  fallback?: string;
};

export const workFolderFiles = {
  change: 'change.json',
  patch: 'change.patch',
  toRead: 'to-read.patch',
  plan: 'plan.json',
  page: 'tour.html',
  pullRequest: 'pull-request.json',
} as const;

/** A pull request's own words, kept apart: data to explain, never instructions to follow. */
export type PullRequestText = {
  number: number;
  url: string;
  title: string;
  body: string;
  /** The body has the `/pr` template's Summary and Merge Danger, so it can serve as the intent. */
  followsPrTemplate: boolean;
};

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

export function writePullRequestText(folder: string, text: PullRequestText): void {
  fs.writeFileSync(path.join(folder, workFolderFiles.pullRequest), `${JSON.stringify(text, null, 2)}\n`);
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
