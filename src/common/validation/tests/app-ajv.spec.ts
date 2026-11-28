import { getAppAjv, resetAppAjvForTests } from '../app-ajv';

describe('getAppAjv', () => {
  beforeEach(() => {
    resetAppAjvForTests();
  });

  it('returns a cached AJV instance until reset', () => {
    const first = getAppAjv();
    const second = getAppAjv();
    expect(second).toBe(first);
  });

  it('returns a new AJV instance after resetAppAjvForTests', () => {
    const first = getAppAjv();
    resetAppAjvForTests();
    const second = getAppAjv();
    expect(second).not.toBe(first);
  });

  it('registers ajv-formats keywords on the singleton', () => {
    const ajv = getAppAjv();
    const validateEmail = ajv.compile({
      type: 'string',
      format: 'email',
    });
    expect(validateEmail('user@example.com')).toBe(true);
    expect(validateEmail('not-an-email')).toBe(false);
  });
});
