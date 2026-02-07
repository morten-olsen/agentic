/**
 * Base error for external service operations.
 */
class ExternalServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExternalServiceError';
  }
}

/**
 * Error when a service is not found in the registry.
 */
class ServiceNotFoundError extends ExternalServiceError {
  constructor(serviceId: string) {
    super(`Unknown service: ${serviceId}`);
    this.name = 'ServiceNotFoundError';
  }
}

/**
 * Error when a service is not configured.
 */
class ServiceNotConfiguredError extends ExternalServiceError {
  constructor(serviceId: string) {
    super(`Service not configured: ${serviceId}`);
    this.name = 'ServiceNotConfiguredError';
  }
}

/**
 * Error when service connection fails.
 */
class ServiceConnectionError extends ExternalServiceError {
  constructor(serviceId: string, cause?: Error) {
    super(`Failed to connect to service: ${serviceId}${cause ? ` - ${cause.message}` : ''}`);
    this.name = 'ServiceConnectionError';
    this.cause = cause;
  }
}

export { ExternalServiceError, ServiceNotFoundError, ServiceNotConfiguredError, ServiceConnectionError };
