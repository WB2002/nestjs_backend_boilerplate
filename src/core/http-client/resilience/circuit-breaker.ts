import { CircuitOpenError } from '../errors';

export type CircuitState = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private failures = 0;
  private state: CircuitState = 'closed';
  private openedAt = 0;
  private halfOpenAttempts = 0;

  constructor(
    private readonly failureThreshold: number,
    private readonly resetTimeout: number,
    private readonly halfOpenMaxAttempts = 1,
  ) {
    if (failureThreshold < 1) {
      throw new Error('failureThreshold must be >= 1');
    }
    if (resetTimeout < 1) {
      throw new Error('resetTimeout must be >= 1');
    }
  }

  getState(now = Date.now()): CircuitState {
    this.maybeTransition(now);
    return this.state;
  }

  assertClosed(now = Date.now()): void {
    this.maybeTransition(now);
    if (this.state === 'open') {
      throw new CircuitOpenError('Circuit breaker is open');
    }
    if (
      this.state === 'half_open' &&
      this.halfOpenAttempts >= this.halfOpenMaxAttempts
    ) {
      throw new CircuitOpenError(
        'Circuit breaker half-open probe limit reached',
      );
    }
    if (this.state === 'half_open') {
      this.halfOpenAttempts += 1;
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this.halfOpenAttempts = 0;
    this.state = 'closed';
  }

  recordFailure(now = Date.now()): void {
    if (this.state === 'half_open') {
      this.trip(now);
      return;
    }
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.trip(now);
    }
  }

  private trip(now: number): void {
    this.state = 'open';
    this.openedAt = now;
    this.halfOpenAttempts = 0;
  }

  private maybeTransition(now: number): void {
    if (this.state === 'open' && now - this.openedAt >= this.resetTimeout) {
      this.state = 'half_open';
      this.halfOpenAttempts = 0;
    }
  }
}
