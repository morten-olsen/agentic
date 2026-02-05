/**
 * Error codes for web fetch operations.
 */
type WebFetchErrorCode = 'TIMEOUT' | 'NETWORK' | 'INVALID_URL' | 'SIZE_LIMIT' | 'NOT_HTML' | 'BLOCKED' | 'FETCH_FAILED';

/**
 * Error thrown when a web fetch operation fails.
 */
class WebFetchError extends Error {
  readonly code: WebFetchErrorCode;
  readonly url: string;
  readonly statusCode?: number;

  constructor(code: WebFetchErrorCode, url: string, message: string, statusCode?: number) {
    super(message);
    this.name = 'WebFetchError';
    this.code = code;
    this.url = url;
    this.statusCode = statusCode;
  }
}

/**
 * Creates a timeout error.
 */
const createTimeoutError = (url: string, timeoutMs: number): WebFetchError => {
  return new WebFetchError('TIMEOUT', url, `Request timed out after ${timeoutMs}ms`);
};

/**
 * Creates a network error.
 */
const createNetworkError = (url: string, cause: string): WebFetchError => {
  return new WebFetchError('NETWORK', url, `Network error: ${cause}`);
};

/**
 * Creates an invalid URL error.
 */
const createInvalidUrlError = (url: string, reason: string): WebFetchError => {
  return new WebFetchError('INVALID_URL', url, `Invalid URL: ${reason}`);
};

/**
 * Creates a size limit error.
 */
const createSizeLimitError = (url: string, sizeBytes: number, maxBytes: number): WebFetchError => {
  return new WebFetchError('SIZE_LIMIT', url, `Response size ${sizeBytes} bytes exceeds limit of ${maxBytes} bytes`);
};

/**
 * Creates a not HTML error.
 */
const createNotHtmlError = (url: string, contentType: string): WebFetchError => {
  return new WebFetchError('NOT_HTML', url, `Expected HTML but got content type: ${contentType}`);
};

/**
 * Creates a blocked error (SSRF protection).
 */
const createBlockedError = (url: string, reason: string): WebFetchError => {
  return new WebFetchError('BLOCKED', url, `Request blocked: ${reason}`);
};

/**
 * Creates a fetch failed error.
 */
const createFetchFailedError = (url: string, statusCode: number, statusText: string): WebFetchError => {
  return new WebFetchError('FETCH_FAILED', url, `HTTP ${statusCode}: ${statusText}`, statusCode);
};

export type { WebFetchErrorCode };
export {
  WebFetchError,
  createTimeoutError,
  createNetworkError,
  createInvalidUrlError,
  createSizeLimitError,
  createNotHtmlError,
  createBlockedError,
  createFetchFailedError,
};
