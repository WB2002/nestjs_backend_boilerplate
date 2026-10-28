// Adapted from @klarlabs-studio/fortify-adaptive@0.1.0 (MIT). In-repo copy — do not add npm dependency.

export type AdaptiveAlgorithm = 'aimd' | 'vegas' | 'gradient2';

const DEFAULT_INITIAL_LIMIT = 10;
const DEFAULT_MIN_LIMIT = 1;
const DEFAULT_MAX_LIMIT = 200;
const DEFAULT_SUCCESS_THRESHOLD = 10;
const DEFAULT_VEGAS_ALPHA = 3;
const DEFAULT_VEGAS_BETA = 6;
const DEFAULT_MIN_SAMPLES = 10;
const DEFAULT_GRADIENT_SMOOTHING = 0.2;

export interface AdaptiveLimiterConfigInput {
  algorithm?: AdaptiveAlgorithm;
  initialLimit?: number;
  minLimit?: number;
  maxLimit?: number;
  successThreshold?: number;
  vegasAlpha?: number;
  vegasBeta?: number;
  vegasMinSamples?: number;
  gradientMinSamples?: number;
  gradientSmoothing?: number;
  onLimitChange?: (oldLimit: number, newLimit: number) => void;
  clock?: () => number;
}

export interface AdaptiveLimiterConfig {
  algorithm: AdaptiveAlgorithm;
  initialLimit: number;
  minLimit: number;
  maxLimit: number;
  successThreshold: number;
  vegasAlpha: number;
  vegasBeta: number;
  vegasMinSamples: number;
  gradientMinSamples: number;
  gradientSmoothing: number;
  onLimitChange: ((oldLimit: number, newLimit: number) => void) | undefined;
  clock: (() => number) | undefined;
}

function positiveInt(value: number | undefined, field: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function positiveGradientSmoothing(value: number | undefined): number {
  const v = value ?? DEFAULT_GRADIENT_SMOOTHING;
  if (typeof v !== 'number' || v <= 0 || v > 1) {
    throw new Error('gradientSmoothing must be in (0, 1]');
  }
  return v;
}

function parseAlgorithm(value: AdaptiveAlgorithm | undefined): AdaptiveAlgorithm {
  if (value === undefined) {
    return 'aimd';
  }
  switch (value) {
    case 'aimd':
    case 'vegas':
    case 'gradient2':
      return value;
    default: {
      const _exhaustive: never = value;
      throw new Error(`Unknown adaptive algorithm: ${_exhaustive}`);
    }
  }
}

export function parseAdaptiveConfig(
  config?: AdaptiveLimiterConfigInput,
): AdaptiveLimiterConfig {
  const input = config ?? {};
  const algorithm = parseAlgorithm(input.algorithm);
  let minLimit = positiveInt(input.minLimit, 'minLimit', DEFAULT_MIN_LIMIT);
  let maxLimit = positiveInt(input.maxLimit, 'maxLimit', DEFAULT_MAX_LIMIT);
  let initialLimit = positiveInt(
    input.initialLimit,
    'initialLimit',
    DEFAULT_INITIAL_LIMIT,
  );
  let vegasBeta = positiveInt(input.vegasBeta, 'vegasBeta', DEFAULT_VEGAS_BETA);
  const vegasAlpha = positiveInt(input.vegasAlpha, 'vegasAlpha', DEFAULT_VEGAS_ALPHA);

  if (maxLimit < minLimit) {
    maxLimit = minLimit;
  }
  if (initialLimit < minLimit) {
    initialLimit = minLimit;
  }
  if (initialLimit > maxLimit) {
    initialLimit = maxLimit;
  }
  if (vegasBeta <= vegasAlpha) {
    vegasBeta = vegasAlpha * 2;
  }

  return {
    algorithm,
    minLimit,
    maxLimit,
    initialLimit,
    successThreshold: positiveInt(
      input.successThreshold,
      'successThreshold',
      DEFAULT_SUCCESS_THRESHOLD,
    ),
    vegasAlpha,
    vegasBeta,
    vegasMinSamples: positiveInt(
      input.vegasMinSamples,
      'vegasMinSamples',
      DEFAULT_MIN_SAMPLES,
    ),
    gradientMinSamples: positiveInt(
      input.gradientMinSamples,
      'gradientMinSamples',
      DEFAULT_MIN_SAMPLES,
    ),
    gradientSmoothing: positiveGradientSmoothing(input.gradientSmoothing),
    onLimitChange: input.onLimitChange,
    clock: input.clock,
  };
}
