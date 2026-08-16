import type { HttpRequest, IdempotencyPolicy } from '../types';

export function resolveIdempotencyKey(
  request: HttpRequest,
  policy?: IdempotencyPolicy,
): { request: HttpRequest; key?: string } {
  if (!policy) {
    return { request };
  }

  const headerName = policy.header ?? 'Idempotency-Key';
  const existing = findHeader(request.headers, headerName);
  if (existing) {
    return { request, key: existing };
  }

  if (!policy.generateKey) {
    return { request };
  }

  const key = policy.generateKey();
  const headers = {
    ...(request.headers ?? {}),
    [headerName]: key,
  };
  return {
    request: { ...request, headers },
    key,
  };
}

function findHeader(
  headers: HttpRequest['headers'] | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && value != null) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}
