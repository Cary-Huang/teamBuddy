import type { DateKey } from './types';

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateKey(date: DateKey): Date {
  const match = DATE_KEY_PATTERN.exec(date);
  if (!match) throw new RangeError(`Invalid date key: ${date}`);

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const result = new Date(0);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCFullYear(year, month - 1, day);
  if (
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid date key: ${date}`);
  }
  return result;
}

function formatDateKey(date: Date): DateKey {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}` as DateKey;
}

export function weekday(date: DateKey): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return parseDateKey(date).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function addDays(date: DateKey, days: number): DateKey {
  if (!Number.isInteger(days)) throw new RangeError('days must be an integer');
  const result = parseDateKey(date);
  result.setUTCDate(result.getUTCDate() + days);
  return formatDateKey(result);
}
