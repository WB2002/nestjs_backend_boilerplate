// Adapted from @klarlabs-studio/fortify-adaptive@0.1.0 (MIT). In-repo copy — do not add npm dependency.

export class AdaptiveLimitExceededError extends Error {
  constructor(message = 'Adaptive concurrency limit exceeded') {
    super(message);
    this.name = 'AdaptiveLimitExceededError';
  }
}
