import { PrioritySheddingThresholds } from './priority-shedding.types';

/** Utilization ratio (active/max) at or above which a tier is shed. */
export const DEFAULT_PRIORITY_SHEDDING_THRESHOLDS: PrioritySheddingThresholds = {
  critical: 1,
  high: 0.95,
  normal: 0.85,
  low: 0.7,
};
