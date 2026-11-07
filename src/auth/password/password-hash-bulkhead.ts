import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConcurrencyLimiter } from '@/core/http-client';
import { OverloadRejectedError } from '@/core/overload';
import {
  getRequestSignal,
  remainingMs,
  throwIfAborted,
  RequestCancelledError,
} from '@/core/request-deadline';

export interface PasswordHashBulkheadOptions {
  readonly maxConcurrent: number;
  readonly maxQueue: number;
  readonly maxWaitMs: number;
}

const DEFAULT_AUTH_PASSWORD_HASH_MAX_CONCURRENT = 2;
const DEFAULT_AUTH_PASSWORD_HASH_MAX_QUEUE = 32;
const DEFAULT_AUTH_PASSWORD_HASH_MAX_WAIT_MS = 2000;

function parseNonNegativeInt(value: unknown, defaultValue: number): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return defaultValue;
  }
  return Math.floor(parsed);
}

function parsePositiveInt(value: unknown, defaultValue: number): number {
  const parsed = parseNonNegativeInt(value, defaultValue);
  return Math.max(1, parsed);
}

@Injectable()
export class PasswordHashBulkhead {
  readonly maxConcurrent: number;
  readonly maxQueue: number;
  readonly maxWaitMs: number;
  private readonly limiter: ConcurrencyLimiter;

  constructor(
    @Optional()
    configServiceOrOptions?:
      | ConfigService
      | Partial<PasswordHashBulkheadOptions>,
    @Optional() explicitOptions?: Partial<PasswordHashBulkheadOptions>,
  ) {
    let configService: ConfigService | undefined;
    let options: Partial<PasswordHashBulkheadOptions> | undefined;

    if (
      configServiceOrOptions &&
      typeof (configServiceOrOptions as ConfigService).get === 'function'
    ) {
      configService = configServiceOrOptions as ConfigService;
      options = explicitOptions;
    } else if (
      configServiceOrOptions &&
      typeof (configServiceOrOptions as ConfigService).get !== 'function'
    ) {
      options = configServiceOrOptions as Partial<PasswordHashBulkheadOptions>;
    } else {
      options = explicitOptions;
    }

    this.maxConcurrent =
      options?.maxConcurrent ??
      parsePositiveInt(
        configService?.get<string | number>(
          'AUTH_PASSWORD_HASH_MAX_CONCURRENT',
        ),
        DEFAULT_AUTH_PASSWORD_HASH_MAX_CONCURRENT,
      );

    this.maxQueue =
      options?.maxQueue ??
      parseNonNegativeInt(
        configService?.get<string | number>('AUTH_PASSWORD_HASH_MAX_QUEUE'),
        DEFAULT_AUTH_PASSWORD_HASH_MAX_QUEUE,
      );

    this.maxWaitMs =
      options?.maxWaitMs ??
      parseNonNegativeInt(
        configService?.get<string | number>('AUTH_PASSWORD_HASH_MAX_WAIT_MS'),
        DEFAULT_AUTH_PASSWORD_HASH_MAX_WAIT_MS,
      );

    this.limiter = new ConcurrencyLimiter(this.maxConcurrent);
  }

  get activeCount(): number {
    return this.limiter.activeCount;
  }

  get queuedCount(): number {
    return this.limiter.queuedCount;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const inboundSignal = getRequestSignal();
    if (inboundSignal?.aborted) {
      throwIfAborted();
      throw new RequestCancelledError('Inbound request already aborted');
    }

    if (this.isQueueFull()) {
      throw new OverloadRejectedError('Password hashing capacity exceeded');
    }

    const budgetRemaining = remainingMs();
    const waitTimeoutMs = Math.max(
      0,
      budgetRemaining === undefined
        ? this.maxWaitMs
        : Math.min(this.maxWaitMs, budgetRemaining),
    );

    const timeoutSignal = AbortSignal.timeout(waitTimeoutMs);
    const waitSignal = inboundSignal
      ? AbortSignal.any([timeoutSignal, inboundSignal])
      : timeoutSignal;

    let release: () => void;
    try {
      release = await this.limiter.acquire(waitSignal);
    } catch (error) {
      if (inboundSignal?.aborted) {
        throwIfAborted();
        throw error;
      }
      throw new OverloadRejectedError('Password hashing wait timeout');
    }

    try {
      return await fn();
    } finally {
      release();
    }
  }

  private isQueueFull(): boolean {
    if (this.limiter.activeCount < this.maxConcurrent) {
      return false;
    }
    return this.limiter.queuedCount >= this.maxQueue;
  }
}
