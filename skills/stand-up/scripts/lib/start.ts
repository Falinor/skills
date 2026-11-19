import { parseCommandArgs } from './args.ts';
import { addDays, formatDay, parseDay, previousWorkday, today } from './dates.ts';
import { UserError } from './errors.ts';
import { requireGhLogin, requireTools } from './requirements.ts';
import { workFolderFor, writeContext } from './work-folder.ts';

const usage = 'usage: stand-up start [--since YYYY-MM-DD] [--lang <language tag>]';

/** `tag` in canonical form (`FR` → `fr`), or a UserError when it is not a language tag. */
function canonicalLanguage(tag: string): string {
  try {
    const [canonical] = Intl.getCanonicalLocales(tag);
    if (canonical) return canonical;
  } catch {
    // RangeError: not a well-formed language tag.
  }
  throw new UserError(`--lang must be a language tag like en or fr (found ${tag})`);
}

/** Creates today's work folder and records the period to report on and the page language. */
export function start(args: string[]): void {
  const { values } = parseCommandArgs(
    args,
    { since: { type: 'string' }, lang: { type: 'string', default: 'en' } },
    usage,
    0,
  );
  requireTools(['git', 'gh']);
  requireGhLogin();
  const now = today();
  let since = previousWorkday(now);
  if (values.since !== undefined) {
    const day = parseDay(values.since);
    if (!day || day >= now) throw new UserError(`--since must be a past day like 2026-11-14 (found ${values.since})`);
    since = day;
  }
  const lang = canonicalLanguage(values.lang);

  const until = addDays(now, -1);

  const folder = workFolderFor(formatDay(now));
  writeContext(folder, { today: formatDay(now), since: formatDay(since), until: formatDay(until), lang });
  console.log(
    [
      `Work folder: ${folder}`,
      `Period: ${formatDay(since)} to ${formatDay(until)}`,
      `Language: ${lang}`,
    ].join('\n'),
  );
}
