import { isExampleJobsApiEnabled } from '../is-example-jobs-api-enabled';

describe('isExampleJobsApiEnabled', () => {
  it('is false in production by default', () => {
    expect(isExampleJobsApiEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('is true in development by default', () => {
    expect(isExampleJobsApiEnabled({ NODE_ENV: 'development' })).toBe(true);
  });

  it('is true in production when EXAMPLE_JOBS_API_ENABLED=true', () => {
    expect(
      isExampleJobsApiEnabled({
        NODE_ENV: 'production',
        EXAMPLE_JOBS_API_ENABLED: 'true',
      }),
    ).toBe(true);
  });
});
