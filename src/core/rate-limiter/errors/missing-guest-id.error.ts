export class MissingGuestIdError extends Error {
  constructor() {
    super('Guest ID cookie is required for this rate limit policy');
    this.name = 'MissingGuestIdError';
  }
}
