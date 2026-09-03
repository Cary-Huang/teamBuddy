import { addDays, weekday } from './date-key';
import type {
  CapacityCalendar,
  CapacityCalendarInput,
  CapacityExceptionInput,
  DateKey,
} from './types';

export class InvalidCapacityError extends RangeError {
  constructor(value: number) {
    super(`Capacity must be between 0 and 24 hours: ${value}`);
    this.name = 'InvalidCapacityError';
  }
}

export class NoWorkingDateError extends Error {
  constructor(readonly memberId: string, readonly from: DateKey) {
    super(`No working date exists for ${memberId} on or after ${from}`);
    this.name = 'NoWorkingDateError';
  }
}

function validateHours(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 24) {
    throw new InvalidCapacityError(value);
  }
  return value;
}

function exceptionKey(exception: CapacityExceptionInput): string {
  return `${exception.memberId}\u0000${exception.date}`;
}

export function buildCapacityCalendar(input: CapacityCalendarInput): CapacityCalendar {
  validateHours(input.defaultDailyHours);
  const defaultDailyHours = input.defaultDailyHours;
  const memberDailyHours: Record<string, number | undefined> = { ...input.memberDailyHours };
  for (const value of Object.values(memberDailyHours)) {
    if (value !== undefined) validateHours(value);
  }

  const exceptions = new Map<string, number>();
  for (const exception of [...input.exceptions]) {
    const availableHours = validateHours(exception.availableHours);
    weekday(exception.date); // Validate and normalize the date-key contract at build time.
    exceptions.set(exceptionKey(exception), availableHours);
  }
  const positiveExceptions = new Map<string, DateKey[]>();
  for (const [key, availableHours] of exceptions) {
    if (availableHours > 0) {
      const memberId = key.slice(0, key.indexOf('\u0000'));
      const date = key.slice(key.indexOf('\u0000') + 1) as DateKey;
      const dates = positiveExceptions.get(memberId) ?? [];
      dates.push(date);
      positiveExceptions.set(memberId, dates);
    }
  }
  for (const dates of positiveExceptions.values()) dates.sort();

  return {
    availableHours(memberId: string, date: DateKey): number {
      const key = `${memberId}\u0000${date}`;
      const exception = exceptions.get(key);
      if (exception !== undefined) return exception;

      const day = weekday(date);
      if (day === 0 || day === 6) return 0;
      return memberDailyHours[memberId] ?? defaultDailyHours;
    },

    nextWorkingDate(memberId: string, from: DateKey): DateKey {
      const recurringHours = memberDailyHours[memberId] ?? defaultDailyHours;
      if (recurringHours === 0) {
        const explicitDate = positiveExceptions.get(memberId)?.find((date) => date >= from);
        if (explicitDate !== undefined) return explicitDate;
        throw new NoWorkingDateError(memberId, from);
      }

      let date = from;
      while (this.availableHours(memberId, date) <= 0) {
        date = addDays(date, 1);
      }
      return date;
    },
  };
}
