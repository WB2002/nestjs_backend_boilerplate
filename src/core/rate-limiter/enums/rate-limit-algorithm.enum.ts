export enum RateLimitAlgorithm {
  TokenBucket = 'TokenBucket',
  LeakyBucket = 'LeakyBucket',
  FixedWindowCounter = 'FixedWindowCounter',
  SlidingWindowLog = 'SlidingWindowLog',
  SlidingWindowCounter = 'SlidingWindowCounter',
  ExponentialWeightedMovingAverage = 'ExponentialWeightedMovingAverage',
}
