// ============================================================================
// Trigger Not Found Error
// ============================================================================

class TriggerNotFoundError extends Error {
  readonly triggerId: string;

  constructor(triggerId: string) {
    super(`Trigger not found: ${triggerId}`);
    this.name = 'TriggerNotFoundError';
    this.triggerId = triggerId;
  }
}

// ============================================================================
// Invalid Schedule Error
// ============================================================================

class InvalidScheduleError extends Error {
  readonly schedule: string;
  readonly reason: string;

  constructor(schedule: string, reason: string) {
    super(`Invalid schedule "${schedule}": ${reason}`);
    this.name = 'InvalidScheduleError';
    this.schedule = schedule;
    this.reason = reason;
  }
}

// ============================================================================
// Trigger Limit Exceeded Error
// ============================================================================

class TriggerLimitExceededError extends Error {
  readonly limit: number;
  readonly current: number;

  constructor(limit: number, current: number) {
    super(`Trigger limit exceeded: ${current}/${limit} triggers`);
    this.name = 'TriggerLimitExceededError';
    this.limit = limit;
    this.current = current;
  }
}

// ============================================================================
// Trigger Already Exists Error
// ============================================================================

class TriggerAlreadyExistsError extends Error {
  readonly triggerName: string;

  constructor(triggerName: string) {
    super(`Trigger already exists: ${triggerName}`);
    this.name = 'TriggerAlreadyExistsError';
    this.triggerName = triggerName;
  }
}

// ============================================================================
// Trigger Execution Error
// ============================================================================

class TriggerExecutionError extends Error {
  readonly triggerId: string;
  readonly cause?: Error;

  constructor(triggerId: string, cause?: Error) {
    super(`Failed to execute trigger ${triggerId}: ${cause?.message ?? 'unknown error'}`);
    this.name = 'TriggerExecutionError';
    this.triggerId = triggerId;
    this.cause = cause;
  }
}

// ============================================================================
// Notify Not Allowed Error
// ============================================================================

class NotifyNotAllowedError extends Error {
  constructor() {
    super('The notify tool is only available when running from a trigger invocation');
    this.name = 'NotifyNotAllowedError';
  }
}

// ============================================================================
// Trigger Service Not Configured Error
// ============================================================================

class TriggerServiceNotConfiguredError extends Error {
  constructor() {
    super('Trigger service is not configured. Call configure() first.');
    this.name = 'TriggerServiceNotConfiguredError';
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  TriggerNotFoundError,
  InvalidScheduleError,
  TriggerLimitExceededError,
  TriggerAlreadyExistsError,
  TriggerExecutionError,
  NotifyNotAllowedError,
  TriggerServiceNotConfiguredError,
};
