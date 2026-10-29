export type InboundLoadLevelConfig = {
  enabled: boolean;
  maxQueue: number;
  maxWaitMs: number;
  pollIntervalMs: number;
};
