import { ApiPriorityLevel } from './api-priority-level.enum';

export type PrioritySheddingThresholds = {
  critical: number;
  high: number;
  normal: number;
  low: number;
};

export type PrioritySheddingConfig = {
  enabled: boolean;
  defaultPriority: ApiPriorityLevel;
  thresholds: PrioritySheddingThresholds;
};
