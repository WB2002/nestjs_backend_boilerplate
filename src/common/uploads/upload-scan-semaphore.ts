const DEFAULT_MAX_CONCURRENT_UPLOAD_SCANS = 4;

export class UploadScanSemaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(
    private readonly maxConcurrent = DEFAULT_MAX_CONCURRENT_UPLOAD_SCANS,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }
}
