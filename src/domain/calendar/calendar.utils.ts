import type { CalendarEvent } from './calendar.schemas.ts';

/**
 * Gets the start of a day in the given timezone.
 */
const startOfDay = (date: Date): Date => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

/**
 * Gets the end of a day in the given timezone.
 */
const endOfDay = (date: Date): Date => {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
};

/**
 * Adds hours to a date.
 */
const addHours = (date: Date, hours: number): Date => {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
};

/**
 * Calculates minutes between two dates.
 */
const minutesBetween = (start: Date, end: Date): number => {
  return Math.round((end.getTime() - start.getTime()) / (60 * 1000));
};

/**
 * Checks if an event is happening at a given time.
 */
const isEventAt = (event: CalendarEvent, time: Date): boolean => {
  const eventStart = new Date(event.start);
  const eventEnd = new Date(event.end);
  return time >= eventStart && time < eventEnd;
};

/**
 * Checks if an event is in the future.
 */
const isFutureEvent = (event: CalendarEvent, from: Date = new Date()): boolean => {
  const eventStart = new Date(event.start);
  return eventStart > from;
};

/**
 * Checks if an event overlaps with a time range.
 */
const eventOverlapsRange = (event: CalendarEvent, start: Date, end: Date): boolean => {
  const eventStart = new Date(event.start);
  const eventEnd = new Date(event.end);
  return eventStart < end && eventEnd > start;
};

/**
 * Sorts events by start time.
 */
const sortEventsByStart = (events: CalendarEvent[]): CalendarEvent[] => {
  return [...events].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
};

/**
 * Formats an event for display.
 */
const formatEventTime = (event: CalendarEvent): string => {
  if (event.allDay) {
    return 'All day';
  }

  const start = new Date(event.start);
  const end = new Date(event.end);

  const formatTime = (d: Date): string => {
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return `${formatTime(start)} - ${formatTime(end)}`;
};

/**
 * Gets duration of an event in minutes.
 */
const getEventDuration = (event: CalendarEvent): number => {
  const start = new Date(event.start);
  const end = new Date(event.end);
  return minutesBetween(start, end);
};

export {
  startOfDay,
  endOfDay,
  addHours,
  minutesBetween,
  isEventAt,
  isFutureEvent,
  eventOverlapsRange,
  sortEventsByStart,
  formatEventTime,
  getEventDuration,
};
