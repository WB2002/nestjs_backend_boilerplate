import type { ConcurrencyLimitPolicy } from '../types/policy.types';

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
  const instances = Math.max(1, instanceCount);
  return Math.max(1, Math.floor(policy.maxConcurrent / instances));
}
