import { randomUUID } from 'crypto';
import type { HttpRequest } from '../types';

export interface LogicalOperationContext {
  requestId: string;
  request: HttpRequest;
  idempotencyKey?: string;
  coalescingKey?: string;
  oauthReplayUsed: boolean;
  startedAt: number;
  totalDeadlineAt?: number;
  attempts: number;
}

export interface AttemptContext {
  attempt: number;
  startedAt: number;
  timeoutMs?: number;
}

export function createLogicalOperation(
  request: HttpRequest,
  options: {
    idempotencyKey?: string;
    coalescingKey?: string;
    totalDeadlineAt?: number;
  } = {},
): LogicalOperationContext {
  const context: LogicalOperationContext = {
    requestId: randomUUID(),
    request,
    oauthReplayUsed: false,
    startedAt: Date.now(),
    attempts: 0,
  };
  if (options.idempotencyKey !== undefined) {
    context.idempotencyKey = options.idempotencyKey;
  }
  if (options.coalescingKey !== undefined) {
    context.coalescingKey = options.coalescingKey;
  }
  if (options.totalDeadlineAt !== undefined) {
    context.totalDeadlineAt = options.totalDeadlineAt;
  }
  return context;
}

export function createAttemptContext(
  attempt: number,
  timeoutMs?: number,
): AttemptContext {
  const context: AttemptContext = {
    attempt,
    startedAt: Date.now(),
  };
  if (timeoutMs !== undefined) {
    context.timeoutMs = timeoutMs;
  }
  return context;
}
