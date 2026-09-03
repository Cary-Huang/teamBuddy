import { describe, expect, it } from 'vitest';
import {
  buildCapacityCalendar,
  InvalidCapacityError,
  NoWorkingDateError,
} from './capacity-calendar';
import { addDays, weekday } from './date-key';

const calendar = buildCapacityCalendar({
  timezone: 'Asia/Shanghai',
  defaultDailyHours: 6,
  memberDailyHours: { alice: 5 },
  exceptions: [
    { memberId: 'alice', date: '2026-09-07', availableHours: 0 },
  ],
});

describe('capacity calendar', () => {
  it('returns zero on Saturday and Sunday', () => {
    expect(calendar.availableHours('bob', '2026-09-05')).toBe(0);
    expect(calendar.availableHours('bob', '2026-09-06')).toBe(0);
  });

  it('uses team default hours on a normal Monday', () => {
    expect(calendar.availableHours('bob', '2026-09-07')).toBe(6);
  });

  it('uses a member override', () => {
    expect(calendar.availableHours('alice', '2026-09-08')).toBe(5);
  });

  it('treats from as an inclusive lower bound', () => {
    expect(calendar.nextWorkingDate('alice', '2026-09-08')).toBe('2026-09-08');
  });

  it('uses a leave exception', () => {
    expect(calendar.availableHours('alice', '2026-09-07')).toBe(0);
  });

  it('skips weekends and leave days when finding the next working date', () => {
    expect(calendar.nextWorkingDate('alice', '2026-09-05')).toBe('2026-09-08');
  });

  it('allows a positive exact exception to make a weekend a working day', () => {
    const exceptional = buildCapacityCalendar({
      timezone: 'Asia/Shanghai',
      defaultDailyHours: 6,
      memberDailyHours: {},
      exceptions: [{ memberId: 'bob', date: '2026-09-05', availableHours: 4 }],
    });
    expect(exceptional.availableHours('bob', '2026-09-05')).toBe(4);
  });

  it('rejects capacities outside the valid range', () => {
    expect(() => buildCapacityCalendar({
      timezone: 'Asia/Shanghai', defaultDailyHours: 25, memberDailyHours: {}, exceptions: [],
    })).toThrow(InvalidCapacityError);
    expect(() => buildCapacityCalendar({
      timezone: 'Asia/Shanghai', defaultDailyHours: 6, memberDailyHours: {},
      exceptions: [{ memberId: 'bob', date: '2026-09-05', availableHours: -1 }],
    })).toThrow(InvalidCapacityError);
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => buildCapacityCalendar({
        timezone: 'Asia/Shanghai', defaultDailyHours: 6,
        memberDailyHours: { bob: value }, exceptions: [],
      })).toThrow(InvalidCapacityError);
    }
  });

  it('snapshots input at construction', () => {
    const input = {
      timezone: 'Asia/Shanghai' as const,
      defaultDailyHours: 6,
      memberDailyHours: { bob: 4 } as Record<string, number | undefined>,
      exceptions: [] as { memberId: string; date: `${number}-${number}-${number}`; availableHours: number }[],
    };
    const snapshot = buildCapacityCalendar(input);
    input.defaultDailyHours = 1;
    input.memberDailyHours.bob = 2;
    input.exceptions.push({ memberId: 'bob', date: '2026-09-07', availableHours: 0 });
    expect(snapshot.availableHours('bob', '2026-09-07')).toBe(4);
  });

  it('terminates with NoWorkingDateError for a permanently zero calendar', () => {
    const empty = buildCapacityCalendar({
      timezone: 'Asia/Shanghai', defaultDailyHours: 0, memberDailyHours: {}, exceptions: [],
    });
    expect(() => empty.nextWorkingDate('bob', '2026-09-05')).toThrow(
      new NoWorkingDateError('bob', '2026-09-05'),
    );
    const futureException = buildCapacityCalendar({
      timezone: 'Asia/Shanghai', defaultDailyHours: 0, memberDailyHours: {},
      exceptions: [{ memberId: 'bob', date: '2026-09-08', availableHours: 3 }],
    });
    expect(futureException.nextWorkingDate('bob', '2026-09-05')).toBe('2026-09-08');
  });

  it('uses last-write-wins when a positive exception is followed by zero', () => {
    const calendar = buildCapacityCalendar({
      timezone: 'Asia/Shanghai', defaultDailyHours: 0, memberDailyHours: {},
      exceptions: [
        { memberId: 'bob', date: '2026-09-08', availableHours: 3 },
        { memberId: 'bob', date: '2026-09-08', availableHours: 0 },
      ],
    });
    expect(calendar.availableHours('bob', '2026-09-08')).toBe(0);
    expect(() => calendar.nextWorkingDate('bob', '2026-09-08')).toThrow(NoWorkingDateError);
  });

  it('uses last-write-wins when zero is followed by a positive exception', () => {
    const calendar = buildCapacityCalendar({
      timezone: 'Asia/Shanghai', defaultDailyHours: 0, memberDailyHours: {},
      exceptions: [
        { memberId: 'bob', date: '2026-09-08', availableHours: 0 },
        { memberId: 'bob', date: '2026-09-08', availableHours: 3 },
      ],
    });
    expect(calendar.availableHours('bob', '2026-09-08')).toBe(3);
    expect(calendar.nextWorkingDate('bob', '2026-09-08')).toBe('2026-09-08');
  });

  it('uses UTC calendar arithmetic for date keys', () => {
    expect(weekday('2026-09-05')).toBe(6);
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
  });
});
