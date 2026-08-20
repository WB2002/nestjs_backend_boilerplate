export type EnvField = {
  required: boolean;
};

/**
 * Declarative env schema. Keys with `required: true` must be present and
 * non-empty at boot; missing required keys fail Nest ConfigModule validation.
 */
export const envSchema = {
  // Auth (hard-required)
  JWT_PRIVATE_KEY: { required: true },
  JWT_PUBLIC_KEY: { required: true },
  COOKIE_SECRET: { required: true },
  ACCESS_TOKEN_TTL: { required: true },
  SESSION_TTL: { required: true },

  // MongoDB
  MONGO_URI: { required: true },
  MONGO_PORT: { required: false },

  // Redis (auth JTI revocation)
  REDIS_HOST: { required: true },
  REDIS_PORT: { required: true },

  // Application
  PORT: { required: false },
  NODE_ENV: { required: false },
  ALLOWED_ORIGINS: { required: false },

  // Request deadline
  REQUEST_TIMEOUT_MS: { required: false },
  REQUEST_TIMEOUT_MAX_MS: { required: false },

  // Graceful shutdown
  SHUTDOWN_DRAIN_MS: { required: false },
  SHUTDOWN_FORCE_MS: { required: false },

  // Rate limiting / client IP
  TRUST_PROXY: { required: false },

  // Uploads / ClamAV
  UPLOAD_MAX_FILES: { required: false },
  UPLOAD_MAX_FILE_SIZE: { required: false },
  UPLOAD_MAX_TOTAL_SIZE: { required: false },
  UPLOAD_VIRUS_SCAN: { required: false },
  CLAMAV_HOST: { required: false },
  CLAMAV_PORT: { required: false },

  // Postgres (optional; health only when configured)
  POSTGRES_HOST: { required: false },
  POSTGRES_USER: { required: false },
  POSTGRES_PASSWORD: { required: false },
  POSTGRES_DB: { required: false },
  POSTGRES_PORT: { required: false },

  // Outbound HTTP client
  HTTP_CLIENT_ALLOW_PRIVATE_URLS: { required: false },

  // hCaptcha (SECRET required when CaptchaModule is loaded)
  HCAPTCHA_SITE_KEY: { required: false },
  HCAPTCHA_SECRET: { required: true },
  HCAPTCHA_VERIFY_BASE_URL: { required: false },

  // Slack Incoming Webhooks (optional; notifications no-op without it)
  SLACK_WEBHOOK_URL: { required: false },

  // GraphQL complexity budgets
  GQL_MAX_COMPLEXITY: { required: false },
  GQL_USER_BUDGET: { required: false },
  GQL_MAX_CONCURRENCY: { required: false },
} as const satisfies Record<string, EnvField>;

export type EnvSchema = typeof envSchema;
export type EnvKey = keyof EnvSchema;
