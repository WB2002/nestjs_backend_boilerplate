export class PriorityShedRejectedError extends Error {
  constructor() {
    super('Service unavailable: request priority shed under load');
    this.name = 'PriorityShedRejectedError';
  }
}
