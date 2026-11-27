import { parseGraphQlDriverOptions } from '../parse-graphql-driver-config';

describe('parseGraphQlDriverOptions', () => {
  it('enables graphiql and introspection in development', () => {
    const options = parseGraphQlDriverOptions({
      get: (key: string) => (key === 'NODE_ENV' ? 'development' : undefined),
    } as never);
    expect(options).toEqual({ graphiql: true, introspection: true });
  });

  it('disables graphiql and introspection in production', () => {
    const options = parseGraphQlDriverOptions({
      get: (key: string) => (key === 'NODE_ENV' ? 'production' : undefined),
    } as never);
    expect(options).toEqual({ graphiql: false, introspection: false });
  });

  it('allows disabling introspection explicitly in non-production environments', () => {
    const env = new Map<string, string>([
      ['NODE_ENV', 'test'],
      ['GQL_INTROSPECTION_ENABLED', 'false'],
    ]);
    const options = parseGraphQlDriverOptions({
      get: (key: string) => env.get(key),
    } as never);
    expect(options).toEqual({ graphiql: true, introspection: false });
  });

  it('allows enabling introspection explicitly when configured', () => {
    const env = new Map<string, string>([
      ['NODE_ENV', 'production'],
      ['GQL_INTROSPECTION_ENABLED', 'true'],
    ]);
    const options = parseGraphQlDriverOptions({
      get: (key: string) => env.get(key),
    } as never);
    expect(options).toEqual({ graphiql: false, introspection: true });
  });
});
