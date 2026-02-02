import type { WorkingHours } from './user-model.schemas.ts';

type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

/**
 * Gets the hour and day of week in a specific timezone.
 * Uses Intl.DateTimeFormat for reliable timezone conversion.
 */
const getTimeInTimezone = (date: Date, timezone: string): { hour: number; minute: number; dayOfWeek: number } => {
  try {
    // Get hour using Intl.DateTimeFormat
    const hourFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const hour = parseInt(hourFormatter.format(date), 10);

    // Get minute
    const minuteFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      minute: 'numeric',
    });
    const minute = parseInt(minuteFormatter.format(date), 10);

    // Get day of week (0 = Sunday)
    const dayFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    });
    const dayStr = dayFormatter.format(date);
    const dayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const dayOfWeek = dayMap[dayStr] ?? date.getDay();

    return { hour, minute, dayOfWeek };
  } catch {
    // Fall back to local time if timezone is invalid
    return {
      hour: date.getHours(),
      minute: date.getMinutes(),
      dayOfWeek: date.getDay(),
    };
  }
};

/**
 * Formats a date in a specific timezone as a human-readable local time string.
 */
const formatLocalTime = (date: Date, timezone: string): string => {
  try {
    return date.toLocaleString('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    // Fall back to ISO string if timezone is invalid
    return date.toISOString();
  }
};

/**
 * Determines the time of day based on the hour.
 * - morning: 5-11
 * - afternoon: 12-16
 * - evening: 17-20
 * - night: 21-4
 *
 * @param date - The date to check (defaults to now)
 * @param timezone - The timezone to use (defaults to local system time)
 */
const getTimeOfDay = (date: Date = new Date(), timezone?: string): TimeOfDay => {
  const hour = timezone ? getTimeInTimezone(date, timezone).hour : date.getHours();

  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
};

/**
 * Checks if the given time falls within working hours.
 *
 * @param workingHours - The working hours configuration
 * @param date - The date to check (defaults to now)
 * @param timezone - The timezone to use (defaults to local system time)
 */
const isWorkingHours = (workingHours: WorkingHours, date: Date = new Date(), timezone?: string): boolean => {
  // Get time components in the appropriate timezone
  const { hour, minute, dayOfWeek } = timezone
    ? getTimeInTimezone(date, timezone)
    : { hour: date.getHours(), minute: date.getMinutes(), dayOfWeek: date.getDay() };

  // Check if it's a working day
  if (!workingHours.days.includes(dayOfWeek)) {
    return false;
  }

  // Parse working hours
  const [startHour, startMinute] = workingHours.start.split(':').map(Number);
  const [endHour, endMinute] = workingHours.end.split(':').map(Number);

  // Get current time in minutes from midnight
  const currentMinutes = hour * 60 + minute;
  const startMinutes = (startHour ?? 0) * 60 + (startMinute ?? 0);
  const endMinutes = (endHour ?? 0) * 60 + (endMinute ?? 0);

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
};

/**
 * Gets the current ISO timestamp.
 */
const now = (): string => new Date().toISOString();

export type { TimeOfDay };
export { getTimeOfDay, isWorkingHours, now, getTimeInTimezone, formatLocalTime };
