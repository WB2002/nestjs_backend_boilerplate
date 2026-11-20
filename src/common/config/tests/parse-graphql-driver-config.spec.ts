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
});
