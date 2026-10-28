import { AdaptiveConcurrencyGate } from '../adaptive-concurrency-gate';

describe('AdaptiveConcurrencyGate', () => {
  it('raises limit after consecutive successes under aimd', async () => {
    let limitSnapshot = 0;
    const gate = new AdaptiveConcurrencyGate({
      algorithm: 'aimd',
      initialLimit: 2,
      minLimit: 1,
      maxLimit: 5,
      successThreshold: 2,
      onLimitChange: (_oldLimit, newLimit) => {
        limitSnapshot = newLimit;
      },
    });

    const runOk = () => gate.run(undefined, async () => 'ok');

    await runOk();
    await runOk();
    await runOk();
    await runOk();

    expect(limitSnapshot).toBeGreaterThanOrEqual(3);
  });

  it('halves limit on failure under aimd', async () => {
    let seen = 0;
    const gate = new AdaptiveConcurrencyGate({
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
      gate.run(undefined, async () => {
        throw new Error('downstream');
      }),
    ).rejects.toThrow('downstream');

    expect(seen).toBe(5);
  });
});
