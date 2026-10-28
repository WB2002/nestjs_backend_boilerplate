import { parseCsvPaths } from './parse-csv-paths';

describe('parseCsvPaths', () => {
  const defaults = ['/health'] as const;

  it('returns defaults when unset', () => {
    expect(parseCsvPaths(undefined, defaults)).toEqual(['/health']);
  });

  it('appends extra paths', () => {
    expect(parseCsvPaths('/webhooks/stripe', defaults)).toEqual([
      '/health',
      '/webhooks/stripe',
    ]);
  });
});
