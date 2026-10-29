export class LoadLevelWaitTimeoutError extends Error {
  constructor(message = 'Timed out waiting for inbound capacity') {
    super(message);
    this.name = 'LoadLevelWaitTimeoutError';
  }
}
