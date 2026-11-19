// Days are calendar days, written YYYY-MM-DD and computed at midnight UTC so
// that no time zone or daylight saving shift can move one.
import { UserError } from './errors.ts';

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const dayLength = 24 * 60 * 60 * 1000;

/** The day `text` names, or null when it is not a real YYYY-MM-DD day. */
export function parseDay(text: string): Date | null {
  if (!dayPattern.test(text)) return null;
  const day = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(day.getTime()) || formatDay(day) !== text ? null : day;
}

export function formatDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

export function addDays(day: Date, count: number): Date {
  return new Date(day.getTime() + count * dayLength);
}

/** Today on the local calendar; STAND_UP_TODAY pins it, for tests. */
export function today(): Date {
  const pinned = process.env.STAND_UP_TODAY;
  if (pinned) {
    const day = parseDay(pinned);
    if (!day) throw new UserError(`STAND_UP_TODAY must be a day like 2026-11-19 (found ${pinned})`);
    return day;
  }
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return parseDay(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)!;
}

/** The weekday before `day`: Friday for a Monday or a weekend day. */
export function previousWorkday(day: Date): Date {
  let previous = addDays(day, -1);
  while (previous.getUTCDay() === 0 || previous.getUTCDay() === 6) previous = addDays(previous, -1);
  return previous;
}

/** `day` written out in `lang`, weekday first, as that language writes it. */
export function longDate(day: string, lang: string): string {
  const format = new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return format.format(parseDay(day)!);
}
