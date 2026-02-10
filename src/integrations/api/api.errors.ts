/**
 * API-specific error classes.
 * These errors include HTTP status codes for automatic error handling.
 */

/**
 * Validation error for invalid request data.
 */
class ApiValidationError extends Error {
  statusCode = 400;
  details?: string[];

  constructor(message: string, details?: string[]) {
    super(message);
    this.name = 'ApiValidationError';
    this.details = details;
  }
}

/**
 * Not found error for missing resources.
 */
class ApiNotFoundError extends Error {
  statusCode = 404;
  resourceType: string;
  resourceId: string;

  constructor(resourceType: string, resourceId: string) {
    super(`${resourceType} not found: ${resourceId}`);
    this.name = 'ApiNotFoundError';
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}

/**
 * Conflict error for duplicate resources or invalid state.
 */
class ApiConflictError extends Error {
  statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = 'ApiConflictError';
  }
}

/**
 * Forbidden error for unauthorized operations.
 */
class ApiForbiddenError extends Error {
  statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = 'ApiForbiddenError';
  }
}

export { ApiValidationError, ApiNotFoundError, ApiConflictError, ApiForbiddenError };
