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

  // CSRF (cookie-based browser sessions)
  CSRF_ENABLED: { required: false },
  CSRF_EXEMPT_PATHS: { required: false },

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
  HTTP_KEEP_ALIVE_TIMEOUT_MS: { required: false },
  HEALTH_CHECK_CACHE_TTL_MS: { required: false },

  // Request deadline
  REQUEST_TIMEOUT_MS: { required: false },
  REQUEST_TIMEOUT_MAX_MS: { required: false },

  // Inbound overload (@fastify/under-pressure)
  UNDER_PRESSURE_ENABLED: { required: false },
  UNDER_PRESSURE_MAX_EVENT_LOOP_DELAY_MS: { required: false },
  UNDER_PRESSURE_MAX_HEAP_USED_BYTES: { required: false },
  UNDER_PRESSURE_MAX_RSS_BYTES: { required: false },
  UNDER_PRESSURE_EXPOSE_STATUS_ROUTE: { required: false },
  OVERLOAD_RETRY_AFTER_SEC: { required: false },

  // Inbound fail-fast bulkhead (per VM)
  INBOUND_BULKHEAD_ENABLED: { required: false },
  INBOUND_MAX_IN_FLIGHT: { required: false },
  INBOUND_PRIORITY_SHEDDING_ENABLED: { required: false },
  INBOUND_DEFAULT_API_PRIORITY: { required: false },
  INBOUND_PRIORITY_SHED_CRITICAL_AT: { required: false },
  INBOUND_PRIORITY_SHED_HIGH_AT: { required: false },
  INBOUND_PRIORITY_SHED_NORMAL_AT: { required: false },
  INBOUND_PRIORITY_SHED_LOW_AT: { required: false },
  INBOUND_LOAD_LEVELING_ENABLED: { required: false },
  INBOUND_LOAD_LEVEL_MAX_QUEUE: { required: false },
  INBOUND_LOAD_LEVEL_MAX_WAIT_MS: { required: false },
  INBOUND_LOAD_LEVEL_POLL_MS: { required: false },

  // Graceful shutdown
  SHUTDOWN_DRAIN_MS: { required: false },
  SHUTDOWN_FORCE_MS: { required: false },

  // Rate limiting / client IP
  TRUST_PROXY: { required: false },

  // Multi-VM coordination (rate limit + cache backends)
  RATE_LIMIT_STORAGE: { required: false },
  RATE_LIMIT_FALLBACK_COOLDOWN_MS: { required: false },
  CACHE_STORAGE: { required: false },
  CACHE_TTL_JITTER_RATIO: { required: false },
  CACHE_LOADER_LOCK_TTL_MS: { required: false },
  CACHE_LOADER_WAIT_MS: { required: false },
  CACHE_NEGATIVE_SOFT_TTL_MS: { required: false },
  CACHE_NEGATIVE_HARD_TTL_MS: { required: false },

  // Country access / GeoIP
  GEOIP_DATABASE_PATH: { required: true },
  COUNTRY_ACCESS_REFRESH_INTERVAL_MS: { required: false },
  COUNTRY_ACCESS_UNKNOWN_COUNTRY_POLICY: { required: false },
  COUNTRY_ACCESS_BYPASS_PATHS: { required: false },

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
  HTTP_CLIENT_INSTANCE_COUNT: { required: false },

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
  GQL_CONCURRENCY_KEY_TTL_SEC: { required: false },

  // WebSocket (Socket.IO)
  WEBSOCKET_ENABLED: { required: false },
  WEBSOCKET_PATH: { required: false },
  WEBSOCKET_ALLOW_QUERY_TOKEN: { required: false },
  WEBSOCKET_REDIS_ADAPTER: { required: false },
  WEBSOCKET_MAX_CONNECTIONS_PER_USER: { required: false },
  WEBSOCKET_MAX_INBOUND_BUFFER_BYTES: { required: false },
  WEBSOCKET_MESSAGES_PER_MINUTE: { required: false },
  WEBSOCKET_CONNECTION_KEY_TTL_SEC: { required: false },

  // Feature flags (optional; defaults applied in FeatureFlagService)
  FEATURE_FLAG_ENV: { required: false },
  FEATURE_FLAG_RECONCILE_MS: { required: false },
  FEATURE_FLAG_ADMIN_EMAILS: { required: false },
  FEATURE_FLAG_METRICS: { required: false },

  // Logging
  LOG_REDACTION_ENABLED: { required: false },

  // OpenTelemetry / app EMF metrics
  OTEL_ENABLED: { required: false },
  OTEL_SERVICE_NAME: { required: false },
  OTEL_EXPORTER_OTLP_ENDPOINT: { required: false },
  APP_METRICS_ENABLED: { required: false },

  // Background jobs (BullMQ + Postgres ledger)
  BACKGROUND_JOBS_ENABLED: { required: false },
  BACKGROUND_WORKER_ENABLED: { required: false },
  BACKGROUND_JOBS_DEFAULT_QUEUE: { required: false },
  BACKGROUND_JOBS_CLAIM_LEASE_SEC: { required: false },
  BACKGROUND_JOBS_WORKER_CONCURRENCY: { required: false },
  BACKGROUND_JOBS_LEASE_RECLAIM_ENABLED: { required: false },
  BACKGROUND_JOBS_LEASE_RECLAIM_INTERVAL_MS: { required: false },
  BACKGROUND_JOBS_LEASE_RECLAIM_BATCH_SIZE: { required: false },
  BACKGROUND_JOBS_ORPHAN_MIN_AGE_SEC: { required: false },
} as const satisfies Record<string, EnvField>;

export type EnvSchema = typeof envSchema;
export type EnvKey = keyof EnvSchema;
