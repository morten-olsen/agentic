import * as chrono from 'chrono-node';
import { z } from 'zod';

// ============================================================================
// Date Parsing Utilities
// ============================================================================

/**
 * Parse a natural language date/time string into a Date object.
 * Supports various formats:
 * - "in 5 minutes"
 * - "tomorrow at 9am"
 * - "next Monday"
 * - "2026-02-01T21:50:00Z" (ISO format)
 * - "2026-02-01" (date only)
 * - "9:30 PM" (time today)
 *
 * @param input - The natural language date string
 * @param referenceDate - Reference date for relative expressions (defaults to now)
 * @returns Parsed Date or null if parsing failed
 */
const parseDate = (input: string, referenceDate?: Date): Date | null => {
  const ref = referenceDate ?? new Date();

  // Try chrono-node for natural language parsing
  const results = chrono.parse(input, ref, { forwardDate: true });

  if (results.length > 0) {
    return results[0].start.date();
  }

  // Fallback: try native Date parsing for ISO strings
  const nativeDate = new Date(input);
  if (!isNaN(nativeDate.getTime())) {
    return nativeDate;
  }

  return null;
};

/**
 * Parse a date string and return an ISO datetime string.
 *
 * @param input - The natural language date string
 * @param referenceDate - Reference date for relative expressions
 * @returns ISO datetime string or null if parsing failed
 */
const parseDateToISO = (input: string, referenceDate?: Date): string | null => {
  const date = parseDate(input, referenceDate);
  return date ? date.toISOString() : null;
};

/**
 * Parse a date string and return a date-only string (YYYY-MM-DD).
 *
 * @param input - The natural language date string
 * @param referenceDate - Reference date for relative expressions
 * @returns Date string in YYYY-MM-DD format or null if parsing failed
 */
const parseDateOnly = (input: string, referenceDate?: Date): string | null => {
  const date = parseDate(input, referenceDate);
  if (!date) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// ============================================================================
// Zod Schemas with Date Parsing
// ============================================================================

/**
 * Schema for flexible datetime input that accepts:
 * - ISO datetime strings
 * - Natural language like "in 5 minutes", "tomorrow at 3pm"
 *
 * Transforms the input to an ISO datetime string.
 */
const flexibleDatetimeSchema = z
  .string()
  .describe(
    'Date/time - accepts ISO format (2026-02-01T10:00:00Z) or natural language (e.g., "in 5 minutes", "tomorrow at 9am", "next Monday")',
  )
  .transform((val, ctx) => {
    const result = parseDateToISO(val);
    if (!result) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Could not parse date/time: "${val}". Try formats like "in 5 minutes", "tomorrow at 9am", "2026-02-01T10:00:00Z"`,
      });
      return z.NEVER;
    }
    return result;
  });

/**
 * Schema for flexible date input that accepts:
 * - YYYY-MM-DD format
 * - ISO datetime (extracts date part)
 * - Natural language like "tomorrow", "next Friday"
 *
 * Transforms the input to a YYYY-MM-DD string.
 */
const flexibleDateSchema = z
  .string()
  .describe('Date - accepts YYYY-MM-DD format or natural language (e.g., "tomorrow", "next Monday", "in 3 days")')
  .transform((val, ctx) => {
    const result = parseDateOnly(val);
    if (!result) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Could not parse date: "${val}". Try formats like "tomorrow", "next Monday", "2026-02-01"`,
      });
      return z.NEVER;
    }
    return result;
  });

/**
 * Optional flexible datetime schema - field can be omitted entirely.
 * When provided, transforms the input to ISO datetime string.
 */
const optionalFlexibleDatetimeSchema = flexibleDatetimeSchema.optional();

/**
 * Optional flexible date schema - field can be omitted entirely.
 * When provided, transforms the input to YYYY-MM-DD string.
 */
const optionalFlexibleDateSchema = flexibleDateSchema.optional();

// ============================================================================
// Exports
// ============================================================================

export {
  parseDate,
  parseDateToISO,
  parseDateOnly,
  flexibleDatetimeSchema,
  flexibleDateSchema,
  optionalFlexibleDatetimeSchema,
  optionalFlexibleDateSchema,
};
