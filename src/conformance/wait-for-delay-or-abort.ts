export function waitForDelayOrAbort(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }

  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    let timeoutTimer: NodeJS.Timeout | undefined;

    const handleAbort = (): void => {
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }
      reject(signal?.reason);
    };

    if (signal) {
      signal.addEventListener('abort', handleAbort, { once: true });
    }

    timeoutTimer = setTimeout(() => {
      timeoutTimer = undefined;
      if (signal) {
        signal.removeEventListener('abort', handleAbort);
      }
      resolve();
    }, delayMs);
  });
}
