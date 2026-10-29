export type LogRedactionConfig = {
  enabled: boolean;
};

export function parseLogRedactionConfig(
  env: Record<string, string | undefined>,
): LogRedactionConfig {
  return {
    enabled: env.LOG_REDACTION_ENABLED !== 'false',
  };
}
