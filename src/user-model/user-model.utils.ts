import type { WorkingHours } from './user-model.schemas.ts';

type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

/**
 * Determines the time of day based on the hour.
 * - morning: 5-11
 * - afternoon: 12-16
 * - evening: 17-20
 * - night: 21-4
 */
const getTimeOfDay = (date: Date = new Date()): TimeOfDay => {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
};

/**
 * Checks if the given time falls within working hours.
 */
const isWorkingHours = (workingHours: WorkingHours, date: Date = new Date()): boolean => {
  // Check if it's a working day
  const dayOfWeek = date.getDay(); // 0 = Sunday
  if (!workingHours.days.includes(dayOfWeek)) {
    return false;
  }

  // Parse working hours
  const [startHour, startMinute] = workingHours.start.split(':').map(Number);
  const [endHour, endMinute] = workingHours.end.split(':').map(Number);

  // Get current time in minutes from midnight
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  const startMinutes = (startHour ?? 0) * 60 + (startMinute ?? 0);
  const endMinutes = (endHour ?? 0) * 60 + (endMinute ?? 0);

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
};

/**
 * Gets the current ISO timestamp.
 */
const now = (): string => new Date().toISOString();

export type { TimeOfDay };
export { getTimeOfDay, isWorkingHours, now };
