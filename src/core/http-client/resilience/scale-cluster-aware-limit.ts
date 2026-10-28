export function scaleClusterAwareLimit(
  value: number,
  instanceCount: number,
): number {
  const instances = Math.max(1, instanceCount);
  return Math.max(1, Math.floor(value / instances));
}
