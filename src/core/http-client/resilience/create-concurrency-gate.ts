import type { ConcurrencyLimitPolicy } from '../types/policy.types';
import { AdaptiveConcurrencyGate } from './adaptive-concurrency-gate';
import { ConcurrencyLimiter } from './concurrency-limit';
import type { ConcurrencyGate } from './concurrency-gate.types';
import { FixedConcurrencyGate } from './fixed-concurrency-gate';
import { parseHttpClientInstanceCount } from './parse-http-client-instance-count';
import { resolveAdaptiveConcurrencyConfig } from './resolve-adaptive-concurrency-config';
import { resolveEffectiveMaxConcurrent } from './resolve-max-concurrent';

export function createConcurrencyGate(
  policy: ConcurrencyLimitPolicy | undefined,
): ConcurrencyGate | undefined {
  if (!policy) {
    return undefined;
  }
  const mode = policy.mode ?? 'fixed';
  const instanceCount = parseHttpClientInstanceCount();
  switch (mode) {
    case 'fixed': {
      const max = resolveEffectiveMaxConcurrent(policy, instanceCount);
      return new FixedConcurrencyGate(new ConcurrencyLimiter(max));
    }
    case 'adaptive': {
      const config = resolveAdaptiveConcurrencyConfig(policy, instanceCount);
      return new AdaptiveConcurrencyGate(config);
    }
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unknown concurrency mode: ${_exhaustive}`);
    }
  }
}
