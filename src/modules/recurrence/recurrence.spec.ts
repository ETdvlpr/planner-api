import { RecurrenceFrequency } from '@prisma/client';
import {
  nextAfter,
  reminderFor,
  Weekdays,
  dartWeekday,
  type RecurrenceSpec,
} from './recurrence.spec-model';

/**
 * These cases exist to pin this implementation to the Dart one in
 * `planner-mobile/lib/core/models/recurrence.dart`. If a case here changes, the
 * Dart test must change with it, or a recurring obligation will land on
 * different dates depending on which client completed the previous occurrence.
 */
const base: RecurrenceSpec = {
  frequency: RecurrenceFrequency.daily,
  interval: 1,
  weekdaysMask: null,
  dayOfMonth: null,
  monthOfYear: null,
  reminderDaysBefore: null,
  reminderMinuteOfDay: null,
  endDate: null,
};

const at = (y: number, m: number, d: number, h = 9, min = 0) =>
  new Date(y, m - 1, d, h, min);

const iso = (date: Date | null) =>
  date
    ? `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
    : null;

describe('recurrence', () => {
  describe('weekday bitmask', () => {
    it('puts Monday in bit 0 and Sunday in bit 6', () => {
      expect(Weekdays.bit(1)).toBe(1);
      expect(Weekdays.bit(7)).toBe(64);
    });

    it('maps JS Sunday-0 onto Dart Monday-1', () => {
      expect(dartWeekday(at(2026, 9, 6))).toBe(7); // a Sunday
      expect(dartWeekday(at(2026, 9, 7))).toBe(1); // the Monday after
    });
  });

  describe('daily', () => {
    it('steps by the interval', () => {
      const spec = { ...base, interval: 3 };
      expect(iso(nextAfter(spec, at(2026, 9, 10)))).toBe('2026-9-13');
    });

    it('treats an interval below 1 as 1', () => {
      const spec = { ...base, interval: 0 };
      expect(iso(nextAfter(spec, at(2026, 9, 10)))).toBe('2026-9-11');
    });
  });

  describe('weekly', () => {
    it('steps seven days per interval', () => {
      const spec = {
        ...base,
        frequency: RecurrenceFrequency.everyNWeeks,
        interval: 2,
      };
      expect(iso(nextAfter(spec, at(2026, 9, 10)))).toBe('2026-9-24');
    });
  });

  describe('monthly', () => {
    it('keeps the day of month', () => {
      const spec = {
        ...base,
        frequency: RecurrenceFrequency.monthly,
        dayOfMonth: 15,
      };
      expect(iso(nextAfter(spec, at(2026, 9, 15)))).toBe('2026-10-15');
    });

    it('clamps a 31st to the length of a short month', () => {
      const spec = {
        ...base,
        frequency: RecurrenceFrequency.monthly,
        dayOfMonth: 31,
      };
      // October 31 → November has 30 days.
      expect(iso(nextAfter(spec, at(2026, 10, 31)))).toBe('2026-11-30');
    });

    it('does not drift after a clamped month', () => {
      const spec = {
        ...base,
        frequency: RecurrenceFrequency.monthly,
        dayOfMonth: 31,
      };
      // The rule, not the previous occurrence, decides the day — so December
      // comes back to the 31st rather than staying on the 30th.
      expect(iso(nextAfter(spec, at(2026, 11, 30)))).toBe('2026-12-31');
    });

    it('steps by N months when asked', () => {
      const spec = {
        ...base,
        frequency: RecurrenceFrequency.everyNMonths,
        interval: 3,
        dayOfMonth: 1,
      };
      expect(iso(nextAfter(spec, at(2026, 9, 1)))).toBe('2026-12-1');
    });
  });

  describe('yearly', () => {
    it('advances the year and honours the month', () => {
      const spec = {
        ...base,
        frequency: RecurrenceFrequency.yearly,
        monthOfYear: 2,
        dayOfMonth: 28,
      };
      expect(iso(nextAfter(spec, at(2026, 2, 28)))).toBe('2027-2-28');
    });

    it('clamps 29 February onto a non-leap year', () => {
      const spec = {
        ...base,
        frequency: RecurrenceFrequency.yearly,
        monthOfYear: 2,
        dayOfMonth: 29,
      };
      expect(iso(nextAfter(spec, at(2028, 2, 29)))).toBe('2029-2-28');
    });
  });

  describe('selected weekdays', () => {
    it('finds the next selected day', () => {
      // Monday + Thursday.
      const spec = {
        ...base,
        frequency: RecurrenceFrequency.selectedWeekdays,
        weekdaysMask: Weekdays.bit(1) | Weekdays.bit(4),
      };
      // 2026-09-10 is a Thursday, so the next is the following Monday.
      expect(iso(nextAfter(spec, at(2026, 9, 10)))).toBe('2026-9-14');
    });

    it('returns null when no day is selected', () => {
      const spec = {
        ...base,
        frequency: RecurrenceFrequency.selectedWeekdays,
        weekdaysMask: 0,
      };
      expect(nextAfter(spec, at(2026, 9, 10))).toBeNull();
    });
  });

  describe('end date', () => {
    it('stops the series once passed', () => {
      const spec = { ...base, endDate: at(2026, 9, 10, 23, 59) };
      expect(nextAfter(spec, at(2026, 9, 10))).toBeNull();
    });

    it('allows an occurrence exactly on the end date', () => {
      const spec = { ...base, endDate: at(2026, 9, 11, 9, 0) };
      expect(iso(nextAfter(spec, at(2026, 9, 10)))).toBe('2026-9-11');
    });
  });

  describe('reminders', () => {
    it('fires the configured number of days before, at the configured time', () => {
      const spec = {
        ...base,
        reminderDaysBefore: 2,
        reminderMinuteOfDay: 8 * 60 + 30,
      };
      const reminder = reminderFor(spec, at(2026, 9, 10, 17, 0))!;
      expect(iso(reminder)).toBe('2026-9-8');
      expect(reminder.getHours()).toBe(8);
      expect(reminder.getMinutes()).toBe(30);
    });

    it('defaults to 09:00 when no time is set', () => {
      const spec = { ...base, reminderDaysBefore: 1 };
      expect(reminderFor(spec, at(2026, 9, 10))!.getHours()).toBe(9);
    });

    it('produces nothing when the rule has no reminder', () => {
      expect(reminderFor(base, at(2026, 9, 10))).toBeNull();
    });
  });
});
