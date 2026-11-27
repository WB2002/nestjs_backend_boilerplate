import { isOpenApiEnabled } from '../is-openapi-enabled';

describe('isOpenApiEnabled', () => {
  it('is false in production by default', () => {
    expect(isOpenApiEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('is true in development and test by default', () => {
    expect(isOpenApiEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(isOpenApiEnabled({ NODE_ENV: 'test' })).toBe(true);
  });

  it('is true in production when ENABLE_OPENAPI=true', () => {
    expect(
      isOpenApiEnabled({
        NODE_ENV: 'production',
        ENABLE_OPENAPI: 'true',
      }),
    ).toBe(true);
  });

  it('is false in development when ENABLE_OPENAPI=false', () => {
    expect(
      isOpenApiEnabled({
        NODE_ENV: 'development',
        ENABLE_OPENAPI: 'false',
      }),
    ).toBe(false);
  });
});
