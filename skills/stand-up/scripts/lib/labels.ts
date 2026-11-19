// The page's fixed words. English and French ship here; for any other
// language the plan carries every label, translated by the agent.
import { UserError } from './errors.ts';

export const labelKeys = [
  'standUp',
  'yesterday',
  'since',
  'today',
  'blockers',
  'nothing',
  'item',
  'items',
  'details',
  'product',
  'tech',
  'links',
  'previous',
  'next',
  'close',
  'badgePullRequest',
  'badgeIssue',
  'badgeDocument',
  'badgeGithub',
  'badgeLink',
] as const;

export type LabelKey = (typeof labelKeys)[number];
export type Labels = Record<LabelKey, string>;

const builtIn: Record<string, Labels> = {
  en: {
    standUp: 'Stand-up',
    yesterday: 'Yesterday',
    since: 'Since',
    today: 'Today',
    blockers: 'Blockers',
    nothing: 'Nothing to report',
    item: 'item',
    items: 'items',
    details: 'Details',
    product: 'Product summary',
    tech: 'Technical details',
    links: 'Links',
    previous: 'Previous',
    next: 'Next',
    close: 'Close',
    badgePullRequest: 'PR',
    badgeIssue: 'Issue',
    badgeDocument: 'Doc',
    badgeGithub: 'GitHub',
    badgeLink: 'Link',
  },
  fr: {
    standUp: 'Point quotidien',
    yesterday: 'Hier',
    since: 'Depuis',
    today: 'Aujourd’hui',
    blockers: 'Blocages',
    nothing: 'Rien à signaler',
    item: 'élément',
    items: 'éléments',
    details: 'Détails',
    product: 'Résumé produit',
    tech: 'Détails techniques',
    links: 'Liens',
    previous: 'Précédent',
    next: 'Suivant',
    close: 'Fermer',
    badgePullRequest: 'PR',
    badgeIssue: 'Issue',
    badgeDocument: 'Doc',
    badgeGithub: 'GitHub',
    badgeLink: 'Lien',
  },
};

const isLabelKey = (key: string): key is LabelKey => (labelKeys as readonly string[]).includes(key);

/**
 * The labels for `lang`: the built-in ones for its language with the plan's
 * overrides on top, or, for a language without built-in labels, the plan's
 * own, which must then be complete. Problems are pushed onto `violations`.
 */
export function resolveLabels(lang: string, overrides: unknown, violations: string[]): Labels {
  const given: Partial<Labels> = {};
  if (overrides !== undefined) {
    if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
      violations.push('labels must be an object of label: text');
    } else {
      for (const [key, value] of Object.entries(overrides)) {
        if (!isLabelKey(key)) violations.push(`unknown label ${key}`);
        else if (typeof value !== 'string' || !value.trim()) violations.push(`label ${key} is empty`);
        else given[key] = value;
      }
    }
  }
  const base = builtIn[new Intl.Locale(lang).language];
  if (base) return { ...base, ...given };
  const missing = labelKeys.filter((key) => !given[key]);
  if (missing.length) violations.push(`labels for ${lang} are missing: ${missing.join(', ')} (run labels for the English ones to translate)`);
  return { ...builtIn.en, ...given };
}

/** `labels`: prints the English labels as JSON, the keys a plan in another language must translate. */
export function printLabels(args: string[]): void {
  if (args.length) throw new UserError('usage: stand-up labels');
  console.log(JSON.stringify(builtIn.en, null, 2));
}
