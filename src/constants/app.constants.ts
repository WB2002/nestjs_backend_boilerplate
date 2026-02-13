export const LOG_COLOR_MAPPER: Record<string, string> = {
  timestamp: '\x1b[33m', // Yellow
  context: '\x1b[35m',   // Magenta
  requestId: '\x1b[32m', // Green
  userId: '\x1b[36m',    // Cyan
  reset: '\x1b[0m',
};
