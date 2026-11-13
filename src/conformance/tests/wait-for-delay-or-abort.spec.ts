import { waitForDelayOrAbort } from '../wait-for-delay-or-abort';

describe('waitForDelayOrAbort', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('resolves after specified delayMs when signal is undefined', async () => {
    let isResolved = false;
    const waitPromise = waitForDelayOrAbort(500, undefined).then(() => {
      isResolved = true;
    });

    expect(isResolved).toBe(false);
    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(499);
    await Promise.resolve();
    expect(isResolved).toBe(false);

    jest.advanceTimersByTime(1);
    await waitPromise;
    expect(isResolved).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('resolves immediately when delayMs is 0 or negative without scheduling a timer', async () => {
    await expect(waitForDelayOrAbort(0, undefined)).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);

    await expect(waitForDelayOrAbort(-10, undefined)).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects with the abort reason when aborted mid-wait, and timer count is 0 afterward', async () => {
    const abortController = new AbortController();
    const abortReason = new Error('deadline timeout');

    let isSettled = false;
    const waitPromise = waitForDelayOrAbort(
      1_000,
      abortController.signal,
    ).finally(() => {
      isSettled = true;
    });

    expect(isSettled).toBe(false);
    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(250);
    expect(isSettled).toBe(false);

    abortController.abort(abortReason);

    await expect(waitPromise).rejects.toBe(abortReason);
    expect(isSettled).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects immediately for a pre-aborted signal without arming a timer', async () => {
    const abortController = new AbortController();
    const preAbortReason = new Error('already aborted');
    abortController.abort(preAbortReason);

    const waitPromise = waitForDelayOrAbort(1_000, abortController.signal);

    await expect(waitPromise).rejects.toBe(preAbortReason);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('removes abort event listener once the timer resolves successfully', async () => {
    const abortController = new AbortController();
    const addEventListenerSpy = jest.spyOn(
      abortController.signal,
      'addEventListener',
    );
    const removeEventListenerSpy = jest.spyOn(
      abortController.signal,
      'removeEventListener',
    );

    const waitPromise = waitForDelayOrAbort(200, abortController.signal);
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'abort',
      expect.any(Function),
      { once: true },
    );

    jest.advanceTimersByTime(200);
    await waitPromise;

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'abort',
      expect.any(Function),
    );
    expect(jest.getTimerCount()).toBe(0);
  });
});
