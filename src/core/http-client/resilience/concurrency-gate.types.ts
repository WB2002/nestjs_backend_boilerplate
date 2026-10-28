export interface ConcurrencyGate {
  run<T>(
    signal: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
  close(error: Error): void;
  readonly activeCount: number;
  readonly queuedCount: number;
}
