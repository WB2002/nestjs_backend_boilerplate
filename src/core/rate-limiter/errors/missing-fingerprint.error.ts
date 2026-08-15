export class MissingFingerprintError extends Error {
  constructor() {
    super('Device fingerprint header is required for this rate limit policy');
    this.name = 'MissingFingerprintError';
  }
}
