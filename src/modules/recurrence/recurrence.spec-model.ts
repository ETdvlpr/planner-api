import { RecurrenceFrequency } from '@prisma/client';

/**
 * A plain description of a recurrence, independent of the database — the direct
 * port of `planner-mobile/lib/core/models/recurrence.dart`.
 *
 * Both sides evaluate this. The client previews the next occurrence while the
 * user is editing; the server materialises it on completion. They must produce
 * the same date for the same rule, or a recurring obligation drifts and its
 * filing history stops lining up — which is the one thing this app promises to
 * get right. `recurrence.service.spec.ts` pins the cases the Dart tests pin.
 */
export interface RecurrenceSpec {
  frequency: RecurrenceFrequency;
  interval: number;
  weekdaysMask: number | null;
  dayOfMonth: number | null;
  monthOfYear: number | null;
  reminderDaysBefore: number | null;
  reminderMinuteOfDay: number | null;
  endDate: Date | null;
}

/** Monday is bit 0 … Sunday is bit 6, matching Dart's `DateTime.monday == 1`. */
export const Weekdays = {
  bit: (weekday: number) => 1 << (weekday - 1),
  contains: (mask: number, weekday: number) =>
    (mask & Weekdays.bit(weekday)) !== 0,
};

/** JS `getDay()` is Sunday-0; Dart's `weekday` is Monday-1. */
export function dartWeekday(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

const effectiveInterval = (spec: RecurrenceSpec) =>
  spec.interval < 1 ? 1 : spec.interval;

/**
 * The due date of the occurrence that follows `from`, or null once the series
 * has passed its end date.
 */
export function nextAfter(spec: RecurrenceSpec, from: Date): Date | null {
  const step = effectiveInterval(spec);
  let next: Date | null;

  switch (spec.frequency) {
    case RecurrenceFrequency.daily:
      next = addDays(from, step);
      break;
    case RecurrenceFrequency.weekly:
    case RecurrenceFrequency.everyNWeeks:
      next = addDays(from, 7 * step);
      break;
    case RecurrenceFrequency.monthly:
    case RecurrenceFrequency.everyNMonths:
      next = nextMonthly(spec, from, step);
      break;
    case RecurrenceFrequency.yearly:
      next = nextYearly(spec, from, step);
      break;
    case RecurrenceFrequency.selectedWeekdays:
      next = nextSelectedWeekday(spec, from);
      break;
    default:
      next = null;
  }

  if (!next) return null;
  if (spec.endDate && next.getTime() > spec.endDate.getTime()) return null;
  return next;
}

/** When the reminder for an occurrence due on `dueDate` should fire. */
export function reminderFor(spec: RecurrenceSpec, dueDate: Date): Date | null {
  if (spec.reminderDaysBefore === null) return null;
  const minute = spec.reminderMinuteOfDay ?? 9 * 60;
  const day = addDays(dateOnly(dueDate), -spec.reminderDaysBefore);
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    Math.floor(minute / 60),
    minute % 60,
  );
}

function nextMonthly(spec: RecurrenceSpec, from: Date, step: number): Date {
  const base = addMonths(from, step);
  if (spec.dayOfMonth === null) return base;
  const lastDay = daysInMonth(base.getFullYear(), base.getMonth());
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    Math.min(spec.dayOfMonth, lastDay),
    from.getHours(),
    from.getMinutes(),
  );
}

function nextYearly(spec: RecurrenceSpec, from: Date, step: number): Date {
  const monthIndex = (spec.monthOfYear ?? from.getMonth() + 1) - 1;
  const year = from.getFullYear() + step;
  const lastDay = daysInMonth(year, monthIndex);
  const day = spec.dayOfMonth ?? from.getDate();
  return new Date(
    year,
    monthIndex,
    Math.min(day, lastDay),
    from.getHours(),
    from.getMinutes(),
  );
}

function nextSelectedWeekday(spec: RecurrenceSpec, from: Date): Date | null {
  const mask = spec.weekdaysMask ?? 0;
  if (mask === 0) return null;
  for (let i = 1; i <= 7; i++) {
    const candidate = addDays(from, i);
    if (Weekdays.contains(mask, dartWeekday(candidate))) return candidate;
  }
  return null;
}

/**
 * Adds whole days by calendar date, not by 86 400 000 ms.
 *
 * Dart's `DateTime.add(Duration(days: n))` is an exact-duration add and shifts
 * the wall-clock time across a DST boundary; this keeps the local time of day,
 * which is what a deadline means to the person who set it.
 */
function addDays(date: Date, days: number): Date {
  const out = new Date(date.getTime());
  out.setDate(out.getDate() + days);
  return out;
}

/** Clamps to the last day of the target month, matching Dart's `addMonths`. */
function addMonths(date: Date, months: number): Date {
  const year = date.getFullYear();
  const month = date.getMonth() + months;
  const lastDay = daysInMonth(year, month);
  return new Date(
    year,
    month,
    Math.min(date.getDate(), lastDay),
    date.getHours(),
    date.getMinutes(),
  );
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function dateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
