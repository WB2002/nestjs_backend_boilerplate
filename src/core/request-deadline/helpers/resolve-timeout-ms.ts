import { readUnknownRecordField } from '@/common/utils';
import { REQUEST_TIMEOUT_HEADER } from '../constants/request-deadline.constants';

/**
 * Parse a positive integer timeout from the request header.
 * Invalid / missing / non-positive values return undefined.
 */
export function parseTimeoutHeader(
  headers: Record<string, unknown> | undefined,
): number | undefined {
  if (!headers) {
    return undefined;
  }

  const raw =
    readUnknownRecordField(headers, REQUEST_TIMEOUT_HEADER) ??
    readUnknownRecordField(headers, REQUEST_TIMEOUT_HEADER.toUpperCase());
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n <= 0) {
    return undefined;
  }

  return Math.floor(n);
}

/** Parse env/config timeout; invalid values fall back to `fallback`. */
export function parsePositiveTimeoutMs(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

export interface ResolveTimeoutInput {
  headerMs?: number;
  routeOverrideMs?: number;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  skipped?: boolean;
}

/**
 * Server budget = route override ?? default.
 * Client header may only shorten that budget.
 * Final value is clamped to maxTimeoutMs (and at least 1ms).
 */
export function resolveTimeoutMs(input: ResolveTimeoutInput): {
  timeoutMs: number | undefined;
  skipped: boolean;
} {
  if (input.skipped) {
    return { timeoutMs: undefined, skipped: true };
  }

  const serverBudget = input.routeOverrideMs ?? input.defaultTimeoutMs;
  const withClient =
    input.headerMs !== undefined
      ? Math.min(input.headerMs, serverBudget)
      : serverBudget;
  const timeoutMs = Math.min(withClient, input.maxTimeoutMs);

  return { timeoutMs: Math.max(1, timeoutMs), skipped: false };
}
