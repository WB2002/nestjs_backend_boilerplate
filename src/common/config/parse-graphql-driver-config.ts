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
  return {
    graphiql: !isProduction,
    introspection: !isProduction,
  };
}
