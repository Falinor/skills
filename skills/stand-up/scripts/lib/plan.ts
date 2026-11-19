// The stand-up plan: what the agent writes into the work folder. The renderer
// trusts none of it: every field is checked here, and every violation is
// reported at once so the agent can fix them in one pass.
import fs from 'node:fs';
import path from 'node:path';
import { UserError } from './errors.ts';
import { resolveLabels, type Labels } from './labels.ts';
import { inlineUrls, isSafeUrl } from './text.ts';
import { workFolderFiles } from './work-folder.ts';

export const tones = ['ok', 'review', 'draft', 'todo', 'warn'] as const;
export type Tone = (typeof tones)[number];

export const sectionKeys = ['yesterday', 'today', 'blockers'] as const;
export type SectionKey = (typeof sectionKeys)[number];

export type Link = { url: string; label: string; matched?: boolean };

export type Item = {
  id: string;
  title: string;
  summary: string;
  kind: string;
  status: { label: string; tone: Tone };
  refs: string;
  product: string;
  tech: string[];
  links: Link[];
};

export type Group = { title: string; hint?: string; items: Item[] };

export type Plan = {
  banner?: string;
  tally?: { value: number | string; label: string }[];
} & Record<SectionKey, Group[]>;

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

export function readPlan(folder: string): unknown {
  const file = path.join(folder, workFolderFiles.plan);
  if (!fs.existsSync(file)) throw new UserError(`no ${workFolderFiles.plan} in ${folder}: write the plan first`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new UserError(`${workFolderFiles.plan} is not valid JSON: ${(error as Error).message}`);
  }
}

function checkUrl(url: unknown, owner: string, violations: string[]): void {
  if (typeof url !== 'string' || !isSafeUrl(url)) violations.push(`${owner}: link ${String(url)} must start with https://`);
}

function checkInlineLinks(text: unknown, owner: string, violations: string[]): void {
  if (typeof text === 'string') for (const url of inlineUrls(text)) checkUrl(url, owner, violations);
}

function checkItem(item: unknown, where: string, seen: Set<string>, violations: string[]): void {
  if (!isObject(item)) {
    violations.push(`${where}: an item must be an object`);
    return;
  }
  const id = isText(item.id) ? item.id : where;
  if (!isText(item.id) || !idPattern.test(item.id)) violations.push(`${id}: id must be lowercase words joined by hyphens, like fix-login`);
  else if (seen.has(item.id)) violations.push(`${id}: id is used more than once`);
  else seen.add(item.id);

  for (const field of ['title', 'summary', 'kind', 'refs', 'product'] as const) {
    if (!isText(item[field])) violations.push(`${id}: ${field} is empty`);
  }
  checkInlineLinks(item.product, id, violations);

  const status = item.status;
  if (!isObject(status) || !isText(status.label)) violations.push(`${id}: status label is empty`);
  if (!isObject(status) || !(tones as readonly unknown[]).includes(status.tone)) {
    violations.push(`${id}: status tone must be one of ${tones.join(', ')}`);
  }

  if (!Array.isArray(item.tech) || !item.tech.length || !item.tech.every(isText)) {
    violations.push(`${id}: tech must be a non-empty list of text`);
  } else {
    for (const line of item.tech) checkInlineLinks(line, id, violations);
  }

  if (!Array.isArray(item.links)) {
    violations.push(`${id}: links must be a list`);
    return;
  }
  for (const link of item.links) {
    if (!isObject(link) || !isText(link.label)) violations.push(`${id}: every link needs a label`);
    if (isObject(link)) checkUrl(link.url, id, violations);
    if (isObject(link) && link.matched !== undefined && typeof link.matched !== 'boolean') {
      violations.push(`${id}: link matched must be true or false`);
    }
  }
}

/** Checks the plan against `lang`; returns it with its labels, or throws every violation at once. */
export function validatePlan(raw: unknown, lang: string): { plan: Plan; labels: Labels } {
  if (!isObject(raw)) throw new UserError(`${workFolderFiles.plan} must hold a JSON object`);
  const violations: string[] = [];
  const seen = new Set<string>();

  for (const key of sectionKeys) {
    const groups = raw[key];
    if (!Array.isArray(groups)) {
      violations.push(`${key} must be a list of groups (empty when there is nothing)`);
      continue;
    }
    groups.forEach((group, index) => {
      if (!isObject(group) || !isText(group.title)) {
        violations.push(`${key} group ${index + 1} needs a title`);
        return;
      }
      const name = `${key} group "${group.title}"`;
      if (group.hint !== undefined && !isText(group.hint)) violations.push(`${name}: hint is empty`);
      checkInlineLinks(group.hint, name, violations);
      if (!Array.isArray(group.items) || !group.items.length) {
        violations.push(`${name} has no items`);
        return;
      }
      group.items.forEach((item, position) => checkItem(item, `${name} item ${position + 1}`, seen, violations));
    });
  }

  if (raw.banner !== undefined && !isText(raw.banner)) violations.push('banner is empty');
  checkInlineLinks(raw.banner, 'banner', violations);
  if (raw.tally !== undefined) {
    const valid =
      Array.isArray(raw.tally) &&
      raw.tally.every((entry) => isObject(entry) && isText(entry.label) && (typeof entry.value === 'number' || isText(entry.value)));
    if (!valid) violations.push('tally must be a list of { value, label }');
  }

  const labels = resolveLabels(lang, raw.labels, violations);
  if (violations.length) {
    throw new UserError(`${workFolderFiles.plan} has problems; fix every one, then render again:\n${violations.map((text) => `- ${text}`).join('\n')}`);
  }
  return { plan: raw as unknown as Plan, labels };
}
