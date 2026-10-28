import type { ConcurrencyLimitPolicy } from '../types/policy.types';
import { scaleClusterAwareLimit } from './scale-cluster-aware-limit';

/**
 * When clusterAware is set, divides maxConcurrent by instance count so the sum
 * across VMs/tasks stays near the configured global budget.
 */
export function resolveEffectiveMaxConcurrent(
  policy: ConcurrencyLimitPolicy,
  instanceCount: number,
): number {
  if (!policy.clusterAware) {
    return policy.maxConcurrent;
  }
  return scaleClusterAwareLimit(policy.maxConcurrent, instanceCount);
}
