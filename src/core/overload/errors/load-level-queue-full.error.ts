export class LoadLevelQueueFullError extends Error {
  constructor(message = 'Inbound load leveling queue is full') {
    super(message);
    this.name = 'LoadLevelQueueFullError';
  }
}
