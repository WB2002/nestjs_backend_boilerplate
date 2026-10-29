import type { AdaptiveLimiterConfigInput } from './adaptive';
import type { ConcurrencyLimitPolicy } from '../types/policy.types';
import { scaleClusterAwareLimit } from './scale-cluster-aware-limit';

const DEFAULT_INITIAL = 10;
const DEFAULT_MIN = 1;
const DEFAULT_ALGORITHM = 'vegas' as const;

export function resolveAdaptiveConcurrencyConfig(
  policy: ConcurrencyLimitPolicy,
  instanceCount: number,
): AdaptiveLimiterConfigInput {
  const tuning = policy.adaptive ?? {};
  const isClusterMode = policy.clusterAware === true;
  const instances = Math.max(1, instanceCount);

  const rawMax = tuning.maxLimit ?? policy.maxConcurrent;
  const rawInitial = tuning.initialLimit ?? DEFAULT_INITIAL;
  const rawMin = tuning.minLimit ?? DEFAULT_MIN;

  const maxLimit = isClusterMode
    ? scaleClusterAwareLimit(rawMax, instances)
    : rawMax;
  const initialLimit = isClusterMode
    ? scaleClusterAwareLimit(rawInitial, instances)
    : rawInitial;
  const minLimit = isClusterMode
    ? scaleClusterAwareLimit(rawMin, instances)
    : rawMin;

  return {
    algorithm: tuning.algorithm ?? DEFAULT_ALGORITHM,
    initialLimit,
    minLimit,
    maxLimit,
    ...(tuning.successThreshold !== undefined
      ? { successThreshold: tuning.successThreshold }
      : {}),
    ...(tuning.vegasAlpha !== undefined
      ? { vegasAlpha: tuning.vegasAlpha }
      : {}),
    ...(tuning.vegasBeta !== undefined ? { vegasBeta: tuning.vegasBeta } : {}),
    ...(tuning.vegasMinSamples !== undefined
      ? { vegasMinSamples: tuning.vegasMinSamples }
      : {}),
    ...(tuning.gradientMinSamples !== undefined
      ? { gradientMinSamples: tuning.gradientMinSamples }
      : {}),
    ...(tuning.gradientSmoothing !== undefined
      ? { gradientSmoothing: tuning.gradientSmoothing }
      : {}),
  };
}
