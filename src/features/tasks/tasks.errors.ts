// ============================================================================
// Task Not Found Error
// ============================================================================

class TaskNotFoundError extends Error {
  readonly taskId: string;
  readonly taskType: 'user' | 'delegated';

  constructor(taskId: string, taskType: 'user' | 'delegated') {
    super(`${taskType === 'user' ? 'User' : 'Delegated'} task not found: ${taskId}`);
    this.name = 'TaskNotFoundError';
    this.taskId = taskId;
    this.taskType = taskType;
  }
}

// ============================================================================
// Invalid Step Error
// ============================================================================

class InvalidStepError extends Error {
  readonly taskId: string;
  readonly stepIndex: number;
  readonly reason: string;

  constructor(taskId: string, stepIndex: number, reason: string) {
    super(`Invalid step ${stepIndex} for task ${taskId}: ${reason}`);
    this.name = 'InvalidStepError';
    this.taskId = taskId;
    this.stepIndex = stepIndex;
    this.reason = reason;
  }
}

// ============================================================================
// Task Already Completed Error
// ============================================================================

class TaskAlreadyCompletedError extends Error {
  readonly taskId: string;

  constructor(taskId: string) {
    super(`Task already completed: ${taskId}`);
    this.name = 'TaskAlreadyCompletedError';
    this.taskId = taskId;
  }
}

// ============================================================================
// Invalid Task State Error
// ============================================================================

class InvalidTaskStateError extends Error {
  readonly taskId: string;
  readonly currentState: string;
  readonly attemptedAction: string;

  constructor(taskId: string, currentState: string, attemptedAction: string) {
    super(`Cannot ${attemptedAction} task ${taskId} in state ${currentState}`);
    this.name = 'InvalidTaskStateError';
    this.taskId = taskId;
    this.currentState = currentState;
    this.attemptedAction = attemptedAction;
  }
}

// ============================================================================
// Exports
// ============================================================================

export { TaskNotFoundError, InvalidStepError, TaskAlreadyCompletedError, InvalidTaskStateError };
