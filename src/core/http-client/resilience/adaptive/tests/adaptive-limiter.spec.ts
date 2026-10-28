import {
  AdaptiveLimiter,
  AdaptiveLimitExceededError,
} from '../index';

describe('AdaptiveLimiter (vendored)', () => {
  it('fail-fast when at cap', async () => {
    const limiter = new AdaptiveLimiter({
      algorithm: 'aimd',
      initialLimit: 1,
      minLimit: 1,
      maxLimit: 5,
    });
    const slow = limiter.execute(async () => {
      await new Promise<void>((r) => {
        setTimeout(r, 50);
      });
      return 'slow';
    });
    await expect(limiter.execute(async () => 'fast')).rejects.toBeInstanceOf(
      AdaptiveLimitExceededError,
    );
    await slow;
  });

  it('aimd increases limit after successThreshold successes', async () => {
    let cap = 0;
    const limiter = new AdaptiveLimiter({
      algorithm: 'aimd',
      initialLimit: 2,
      maxLimit: 6,
      successThreshold: 2,
      onLimitChange: (_o, n) => {
        cap = n;
      },
    });
    for (let i = 0; i < 4; i++) {
      await limiter.execute(async () => 'ok');
    }
    expect(cap).toBeGreaterThanOrEqual(3);
  });

  it('halves limit on failure under aimd', async () => {
    let seen = 0;
    const limiter = new AdaptiveLimiter({
      algorithm: 'aimd',
      initialLimit: 10,
      minLimit: 1,
      maxLimit: 20,
      successThreshold: 100,
      onLimitChange: (_o, n) => {
        seen = n;
      },
    });

    await expect(
      limiter.execute(async () => {
        throw new Error('downstream');
      }),
    ).rejects.toThrow('downstream');

    expect(seen).toBe(5);
  });
});
