import { RequestDeadlineModuleOptions } from '../types/request-deadline.types';

export const REQUEST_DEADLINE_OPTIONS = 'REQUEST_DEADLINE_OPTIONS';

export const SKIP_REQUEST_DEADLINE_KEY = 'skipRequestDeadline';
export const REQUEST_TIMEOUT_KEY = 'requestTimeoutMs';

export const REQUEST_TIMEOUT_HEADER = 'x-request-timeout-ms';

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_REQUEST_TIMEOUT_MAX_MS = 120_000;

export const DEFAULT_REQUEST_DEADLINE_OPTIONS: Required<RequestDeadlineModuleOptions> =
  {
    defaultTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    maxTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MAX_MS,
  };

/** Non-standard nginx-style status for client closed request. */
export const HTTP_STATUS_CLIENT_CLOSED_REQUEST = 499;
