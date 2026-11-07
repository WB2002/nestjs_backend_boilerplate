import { HealthSnapshot } from '../health-snapshot';

describe('HealthSnapshot', () => {
  it('single-flights concurrent in-flight load requests (loader called once)', async () => {
    const fixedNow = 1000;
    const snapshot = new HealthSnapshot<string>(2000, () => fixedNow);

    let loadCount = 0;
    let resolveLoad!: (resolvedSnapshot: string) => void;
    const loader = jest.fn().mockImplementation(() => {
      loadCount++;
      return new Promise<string>((resolve) => {
        resolveLoad = resolve;
      });
    });

    const pendingPromise1 = snapshot.get(loader);
    const pendingPromise2 = snapshot.get(loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(loadCount).toBe(1);

    resolveLoad('healthy');
    const [snapshot1, snapshot2] = await Promise.all([
      pendingPromise1,
      pendingPromise2,
    ]);
    expect(snapshot1).toBe('healthy');
    expect(snapshot2).toBe('healthy');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('returns cached result within the TTL without calling loader again', async () => {
    let currentNow = 1000;
    const snapshot = new HealthSnapshot<string>(2000, () => currentNow);
    const loader = jest.fn().mockResolvedValue('healthy');

    const snapshot1 = await snapshot.get(loader);
    expect(snapshot1).toBe('healthy');
    expect(loader).toHaveBeenCalledTimes(1);

    currentNow += 1000; // 1000 ms elapsed, TTL is 2000 ms
    const snapshot2 = await snapshot.get(loader);
    expect(snapshot2).toBe('healthy');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('reloads after the TTL expires', async () => {
    let currentNow = 1000;
    const snapshot = new HealthSnapshot<string>(2000, () => currentNow);
    const loader = jest
      .fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');

    const snapshot1 = await snapshot.get(loader);
    expect(snapshot1).toBe('first');
    expect(loader).toHaveBeenCalledTimes(1);

    currentNow += 2001; // TTL expired
    const snapshot2 = await snapshot.get(loader);
    expect(snapshot2).toBe('second');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('does not cache rejected loads and allows subsequent call to retry', async () => {
    const fixedNow = 1000;
    const snapshot = new HealthSnapshot<string>(2000, () => fixedNow);
    const loader = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('success');

    await expect(snapshot.get(loader)).rejects.toThrow('fail');
    expect(loader).toHaveBeenCalledTimes(1);

    // Immediate next call should retry since failure is never cached
    const retriedSnapshot = await snapshot.get(loader);
    expect(retriedSnapshot).toBe('success');
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
