import { FallbackRateLimitBackend } from '../fallback.backend';
import { RateLimitBackend } from '../../types/rate-limit-backend.interface';
import { ConsumeContext, ConsumeResult } from '../../types/rate-limit.types';
import { RateLimitAlgorithm } from '../../enums/rate-limit-algorithm.enum';

function createSampleContext(
  overrides: Partial<ConsumeContext> = {},
): ConsumeContext {
  return {
    algorithm: RateLimitAlgorithm.TokenBucket,
    key: 'test-key',
    limit: 10,
    durationMs: 60_000,
    cost: 1,
    nowMs: 1_000,
    ...overrides,
  };
}

describe('FallbackRateLimitBackend', () => {
  it('uses primary when healthy', async () => {
    const primaryResponse: ConsumeResult = {
      allowed: true,
      remaining: 9,
      resetMs: 1000,
      retryAfterMs: 0,
    };
    const primaryMock: RateLimitBackend = {
      consume: jest.fn().mockResolvedValue(primaryResponse),
    };
    const fallbackMock: RateLimitBackend = {
      consume: jest.fn(),
    };

    const backend = new FallbackRateLimitBackend(primaryMock, fallbackMock, {
      instanceCount: 2,
      cooldownMs: 5000,
    });

    const sampleContext = createSampleContext();
    const consumeOutcome = await backend.consume(sampleContext);

    expect(consumeOutcome).toEqual(primaryResponse);
    expect(primaryMock.consume).toHaveBeenCalledWith(sampleContext);
    expect(fallbackMock.consume).not.toHaveBeenCalled();
  });

  it('falls back with scaled limit when primary throws', async () => {
    const fallbackResponse: ConsumeResult = {
      allowed: true,
      remaining: 4,
      resetMs: 1000,
      retryAfterMs: 0,
    };
    const primaryMock: RateLimitBackend = {
      consume: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const fallbackMock: RateLimitBackend = {
      consume: jest.fn().mockResolvedValue(fallbackResponse),
    };

    const backend = new FallbackRateLimitBackend(primaryMock, fallbackMock, {
      instanceCount: 2,
      cooldownMs: 5000,
    });

    const sampleContext = createSampleContext({ limit: 10 });
    const consumeOutcome = await backend.consume(sampleContext);

    expect(consumeOutcome).toEqual(fallbackResponse);
    expect(fallbackMock.consume).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 }),
    );
  });

  it('scaled limit never below 1', async () => {
    const fallbackResponse: ConsumeResult = {
      allowed: true,
      remaining: 0,
      resetMs: 1000,
      retryAfterMs: 0,
    };
    const primaryMock: RateLimitBackend = {
      consume: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const fallbackMock: RateLimitBackend = {
      consume: jest.fn().mockResolvedValue(fallbackResponse),
    };

    const backend = new FallbackRateLimitBackend(primaryMock, fallbackMock, {
      instanceCount: 4,
      cooldownMs: 5000,
    });

    const sampleContext = createSampleContext({ limit: 1 });
    await backend.consume(sampleContext);

    expect(fallbackMock.consume).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1 }),
    );
  });

  it('scales burst when burst is set', async () => {
    const fallbackResponse: ConsumeResult = {
      allowed: true,
      remaining: 4,
      resetMs: 1000,
      retryAfterMs: 0,
    };
    const primaryMock: RateLimitBackend = {
      consume: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const fallbackMock: RateLimitBackend = {
      consume: jest.fn().mockResolvedValue(fallbackResponse),
    };

    const backend = new FallbackRateLimitBackend(primaryMock, fallbackMock, {
      instanceCount: 2,
      cooldownMs: 5000,
    });

    const sampleContext = createSampleContext({ limit: 10, burst: 20 });
    await backend.consume(sampleContext);

    expect(fallbackMock.consume).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, burst: 10 }),
    );
  });

  it('skips primary during cooldown, retries after', async () => {
    let currentTimestampMs = 0;
    const nowMs = () => currentTimestampMs;

    const fallbackResponse: ConsumeResult = {
      allowed: true,
      remaining: 4,
      resetMs: 1000,
      retryAfterMs: 0,
    };
    const primaryMock: RateLimitBackend = {
      consume: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const fallbackMock: RateLimitBackend = {
      consume: jest.fn().mockResolvedValue(fallbackResponse),
    };

    const backend = new FallbackRateLimitBackend(primaryMock, fallbackMock, {
      instanceCount: 2,
      cooldownMs: 5000,
      nowMs,
    });

    const sampleContext = createSampleContext();

    // t = 0: primary fails, fallback called
    await backend.consume(sampleContext);
    expect(primaryMock.consume).toHaveBeenCalledTimes(1);
    expect(fallbackMock.consume).toHaveBeenCalledTimes(1);

    // t = 1000: in cooldown window, primary skipped
    currentTimestampMs = 1000;
    await backend.consume(sampleContext);
    expect(primaryMock.consume).toHaveBeenCalledTimes(1);
    expect(fallbackMock.consume).toHaveBeenCalledTimes(2);

    // t = 5001: cooldown expired, primary tried again
    currentTimestampMs = 5001;
    await backend.consume(sampleContext);
    expect(primaryMock.consume).toHaveBeenCalledTimes(2);
    expect(fallbackMock.consume).toHaveBeenCalledTimes(3);
  });

  it('quit closes both', async () => {
    const primaryMock: RateLimitBackend = {
      consume: jest.fn(),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    const fallbackMock: RateLimitBackend = {
      consume: jest.fn(),
      quit: jest.fn().mockResolvedValue(undefined),
    };

    const backend = new FallbackRateLimitBackend(primaryMock, fallbackMock, {
      instanceCount: 2,
      cooldownMs: 5000,
    });

    await backend.quit();

    expect(primaryMock.quit).toHaveBeenCalledTimes(1);
    expect(fallbackMock.quit).toHaveBeenCalledTimes(1);
  });
});
