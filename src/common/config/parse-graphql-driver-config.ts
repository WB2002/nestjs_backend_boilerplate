import { ConfigService } from '@nestjs/config';

export type GraphQlDriverSecurityOptions = {
  graphiql: boolean;
  introspection: boolean;
};

export function parseGraphQlDriverOptions(
  configService: Pick<ConfigService, 'get'>,
): GraphQlDriverSecurityOptions {
  const nodeEnv = configService.get<string>('NODE_ENV') ?? 'development';
  const isProduction = nodeEnv === 'production';
  const rawIntrospection = configService.get<string>(
    'GQL_INTROSPECTION_ENABLED',
  );
  let isIntrospectionEnabled = !isProduction;
  if (rawIntrospection === 'true') {
    isIntrospectionEnabled = true;
  } else if (rawIntrospection === 'false') {
    isIntrospectionEnabled = false;
  }

  return {
    graphiql: !isProduction,
    introspection: isIntrospectionEnabled,
  };
}
