// ============================================================================
// Check Not Found Error
// ============================================================================

class CheckNotFoundError extends Error {
  readonly checkId: string;

  constructor(checkId: string) {
    super(`Proactive check not found: ${checkId}`);
    this.name = 'CheckNotFoundError';
    this.checkId = checkId;
  }
}

// ============================================================================
// Check Already Exists Error
// ============================================================================

class CheckAlreadyExistsError extends Error {
  readonly checkName: string;

  constructor(checkName: string) {
    super(`Proactive check already exists: ${checkName}`);
    this.name = 'CheckAlreadyExistsError';
    this.checkName = checkName;
  }
}

// ============================================================================
// Check Execution Error
// ============================================================================

class CheckExecutionError extends Error {
  readonly checkId: string;
  readonly cause?: Error;

  constructor(checkId: string, cause?: Error) {
    super(`Failed to execute check ${checkId}: ${cause?.message ?? 'unknown error'}`);
    this.name = 'CheckExecutionError';
    this.checkId = checkId;
    this.cause = cause;
  }
}

// ============================================================================
// Run Not Found Error
// ============================================================================

class RunNotFoundError extends Error {
  readonly runId: string;

  constructor(runId: string) {
    super(`Proactive run not found: ${runId}`);
    this.name = 'RunNotFoundError';
    this.runId = runId;
  }
}

// ============================================================================
// Invalid Cron Expression Error
// ============================================================================

class InvalidCronExpressionError extends Error {
  readonly expression: string;

  constructor(expression: string) {
    super(`Invalid cron expression: ${expression}`);
    this.name = 'InvalidCronExpressionError';
    this.expression = expression;
  }
}

// ============================================================================
// Scheduler Already Running Error
// ============================================================================

class SchedulerAlreadyRunningError extends Error {
  constructor() {
    super('Proactive scheduler is already running');
    this.name = 'SchedulerAlreadyRunningError';
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  CheckNotFoundError,
  CheckAlreadyExistsError,
  CheckExecutionError,
  RunNotFoundError,
  InvalidCronExpressionError,
  SchedulerAlreadyRunningError,
};
