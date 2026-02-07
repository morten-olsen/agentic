import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';

import {
  parseDate,
  parseDateToISO,
  parseDateOnly,
  flexibleDatetimeSchema,
  flexibleDateSchema,
  optionalFlexibleDatetimeSchema,
  optionalFlexibleDateSchema,
} from './date-parser.ts';

describe('date-parser', () => {
  // Use a fixed reference date for consistent tests
  const referenceDate = new Date('2026-02-01T12:00:00Z');

  beforeEach(() => {
    // Mock Date.now to return a consistent time
    vi.useFakeTimers();
    vi.setSystemTime(referenceDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('parseDate', () => {
    it('should parse ISO datetime strings', () => {
      const result = parseDate('2026-02-15T10:00:00Z');
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe('2026-02-15T10:00:00.000Z');
    });

    it('should parse ISO date strings', () => {
      const result = parseDate('2026-02-15');
      expect(result).toBeInstanceOf(Date);
      // The date should be parsed (exact time depends on timezone/chrono behavior)
      expect(result?.getFullYear()).toBe(2026);
      expect(result?.getMonth()).toBe(1); // February (0-indexed)
      expect(result?.getDate()).toBe(15);
    });

    it('should parse "in X minutes"', () => {
      const result = parseDate('in 5 minutes', referenceDate);
      expect(result).toBeInstanceOf(Date);
      // Should be 5 minutes after reference date
      const expectedTime = new Date(referenceDate.getTime() + 5 * 60 * 1000);
      expect(result?.getTime()).toBe(expectedTime.getTime());
    });

    it('should parse "in X hours"', () => {
      const result = parseDate('in 2 hours', referenceDate);
      expect(result).toBeInstanceOf(Date);
      const expectedTime = new Date(referenceDate.getTime() + 2 * 60 * 60 * 1000);
      expect(result?.getTime()).toBe(expectedTime.getTime());
    });

    it('should parse "tomorrow"', () => {
      const result = parseDate('tomorrow', referenceDate);
      expect(result).toBeInstanceOf(Date);
      expect(result?.getDate()).toBe(2); // Feb 2
    });

    it('should parse "tomorrow at 9am"', () => {
      const result = parseDate('tomorrow at 9am', referenceDate);
      expect(result).toBeInstanceOf(Date);
      expect(result?.getDate()).toBe(2);
      expect(result?.getHours()).toBe(9);
    });

    it('should parse "next Monday"', () => {
      const result = parseDate('next Monday', referenceDate);
      expect(result).toBeInstanceOf(Date);
      // Feb 1, 2026 is a Sunday, so next Monday is Feb 2
      expect(result?.getDay()).toBe(1); // Monday
    });

    it('should return null for invalid input', () => {
      const result = parseDate('not a date');
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = parseDate('');
      expect(result).toBeNull();
    });
  });

  describe('parseDateToISO', () => {
    it('should return ISO string for valid date', () => {
      const result = parseDateToISO('2026-02-15T10:00:00Z');
      expect(result).toBe('2026-02-15T10:00:00.000Z');
    });

    it('should return ISO string for natural language', () => {
      const result = parseDateToISO('in 5 minutes', referenceDate);
      expect(result).toBeTruthy();
      expect(result).toContain('2026-02-01');
    });

    it('should return null for invalid input', () => {
      const result = parseDateToISO('invalid');
      expect(result).toBeNull();
    });
  });

  describe('parseDateOnly', () => {
    it('should return YYYY-MM-DD for valid date', () => {
      const result = parseDateOnly('2026-02-15T10:00:00Z');
      expect(result).toBe('2026-02-15');
    });

    it('should return YYYY-MM-DD for natural language', () => {
      const result = parseDateOnly('tomorrow', referenceDate);
      expect(result).toBe('2026-02-02');
    });

    it('should return null for invalid input', () => {
      const result = parseDateOnly('invalid');
      expect(result).toBeNull();
    });
  });

  describe('flexibleDatetimeSchema', () => {
    it('should transform ISO datetime', () => {
      const result = flexibleDatetimeSchema.safeParse('2026-02-15T10:00:00Z');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('2026-02-15T10:00:00.000Z');
      }
    });

    it('should transform natural language to ISO', () => {
      const result = flexibleDatetimeSchema.safeParse('in 5 minutes');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toContain('2026-02-01');
      }
    });

    it('should fail with helpful error for invalid input', () => {
      const result = flexibleDatetimeSchema.safeParse('not a date');
      expect(result.success).toBe(false);
      if (!result.success) {
        // Zod 4 uses 'issues' instead of 'errors'
        expect(result.error.issues[0].message).toContain('Could not parse');
        expect(result.error.issues[0].message).toContain('in 5 minutes');
      }
    });
  });

  describe('flexibleDateSchema', () => {
    it('should transform ISO date to YYYY-MM-DD', () => {
      const result = flexibleDateSchema.safeParse('2026-02-15T10:00:00Z');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('2026-02-15');
      }
    });

    it('should transform natural language to YYYY-MM-DD', () => {
      const result = flexibleDateSchema.safeParse('tomorrow');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('2026-02-02');
      }
    });

    it('should fail with helpful error for invalid input', () => {
      const result = flexibleDateSchema.safeParse('invalid');
      expect(result.success).toBe(false);
      if (!result.success) {
        // Zod 4 uses 'issues' instead of 'errors'
        expect(result.error.issues[0].message).toContain('Could not parse');
      }
    });
  });

  describe('optionalFlexibleDatetimeSchema', () => {
    it('should return undefined for undefined input', () => {
      const result = optionalFlexibleDatetimeSchema.safeParse(undefined);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeUndefined();
      }
    });

    it('should transform valid input', () => {
      const result = optionalFlexibleDatetimeSchema.safeParse('2026-02-15T10:00:00Z');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('2026-02-15T10:00:00.000Z');
      }
    });

    it('should fail for invalid non-empty input', () => {
      const result = optionalFlexibleDatetimeSchema.safeParse('invalid');
      expect(result.success).toBe(false);
    });

    it('works with z.object for truly optional fields', () => {
      const schema = z.object({
        time: optionalFlexibleDatetimeSchema,
      });

      // Can omit the field entirely
      const result1 = schema.safeParse({});
      expect(result1.success).toBe(true);

      // Can provide a valid value
      const result2 = schema.safeParse({ time: 'tomorrow at 9am' });
      expect(result2.success).toBe(true);
      if (result2.success) {
        expect(result2.data.time).toContain('2026-02-02');
      }
    });
  });

  describe('optionalFlexibleDateSchema', () => {
    it('should return undefined for undefined input', () => {
      const result = optionalFlexibleDateSchema.safeParse(undefined);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeUndefined();
      }
    });

    it('should transform valid input', () => {
      const result = optionalFlexibleDateSchema.safeParse('tomorrow');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('2026-02-02');
      }
    });

    it('works with z.object for truly optional fields', () => {
      const schema = z.object({
        date: optionalFlexibleDateSchema,
      });

      // Can omit the field entirely
      const result1 = schema.safeParse({});
      expect(result1.success).toBe(true);

      // Can provide a valid value
      const result2 = schema.safeParse({ date: 'tomorrow' });
      expect(result2.success).toBe(true);
      if (result2.success) {
        expect(result2.data.date).toBe('2026-02-02');
      }
    });
  });
});
