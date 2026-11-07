export class HealthSnapshot<T> {
  private cachedValue: T | undefined;
  private cachedAt: number | undefined;
  private inFlight: Promise<T> | undefined;

  constructor(
    private readonly ttlMs: number,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  async get(load: () => Promise<T>): Promise<T> {
    const now = this.nowMs();
    if (this.cachedAt !== undefined && now - this.cachedAt < this.ttlMs) {
      return this.cachedValue as T;
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = (async () => {
      try {
        const loadedValue = await load();
        this.cachedValue = loadedValue;
        this.cachedAt = this.nowMs();
        return loadedValue;
      } finally {
        this.inFlight = undefined;
      }
    })();

    return this.inFlight;
  }
}
