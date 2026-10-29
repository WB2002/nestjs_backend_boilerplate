import { REQUEST_DEADLINE_HEADER } from '../constants/request-deadline.constants';

export interface ResolveOutboundDeadlineHeadersInput {
  propagate: boolean;
  inboundDeadlineAt?: number;
  existingHeaders?: Record<string, string | undefined>;
}

function existingDeadlineHeader(
  headers?: Record<string, string | undefined>,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === REQUEST_DEADLINE_HEADER && value != null) {
      return value;
    }
  }
  return undefined;
}

export function resolveOutboundDeadlineHeaders(
  input: ResolveOutboundDeadlineHeadersInput,
): Record<string, string> {
  if (!input.propagate) {
    return {};
  }
  if (input.inboundDeadlineAt === undefined) {
    return {};
  }
  if (existingDeadlineHeader(input.existingHeaders) !== undefined) {
    return {};
  }
  return {
    [REQUEST_DEADLINE_HEADER]: String(input.inboundDeadlineAt),
  };
}
