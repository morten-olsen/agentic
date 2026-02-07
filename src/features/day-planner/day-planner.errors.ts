// ============================================================================
// Day Plan Not Found Error
// ============================================================================

class DayPlanNotFoundError extends Error {
  readonly planId?: string;
  readonly date?: string;

  constructor(idOrDate: string, type: 'id' | 'date' = 'id') {
    super(type === 'id' ? `Day plan not found: ${idOrDate}` : `No day plan found for date: ${idOrDate}`);
    this.name = 'DayPlanNotFoundError';
    if (type === 'id') {
      this.planId = idOrDate;
    } else {
      this.date = idOrDate;
    }
  }
}

// ============================================================================
// Day Plan Already Exists Error
// ============================================================================

class DayPlanAlreadyExistsError extends Error {
  readonly date: string;

  constructor(date: string) {
    super(`A day plan already exists for date: ${date}`);
    this.name = 'DayPlanAlreadyExistsError';
    this.date = date;
  }
}

// ============================================================================
// Priority Not Found Error
// ============================================================================

class PriorityNotFoundError extends Error {
  readonly priorityId: string;

  constructor(priorityId: string) {
    super(`Priority not found: ${priorityId}`);
    this.name = 'PriorityNotFoundError';
    this.priorityId = priorityId;
  }
}

// ============================================================================
// Focus Block Not Found Error
// ============================================================================

class FocusBlockNotFoundError extends Error {
  readonly focusBlockId: string;

  constructor(focusBlockId: string) {
    super(`Focus block not found: ${focusBlockId}`);
    this.name = 'FocusBlockNotFoundError';
    this.focusBlockId = focusBlockId;
  }
}

// ============================================================================
// Invalid Day Plan State Error
// ============================================================================

class InvalidDayPlanStateError extends Error {
  readonly planId: string;
  readonly currentState: string;
  readonly attemptedAction: string;

  constructor(planId: string, currentState: string, attemptedAction: string) {
    super(`Cannot ${attemptedAction} day plan ${planId} in state ${currentState}`);
    this.name = 'InvalidDayPlanStateError';
    this.planId = planId;
    this.currentState = currentState;
    this.attemptedAction = attemptedAction;
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  DayPlanNotFoundError,
  DayPlanAlreadyExistsError,
  PriorityNotFoundError,
  FocusBlockNotFoundError,
  InvalidDayPlanStateError,
};
