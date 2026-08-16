/**
 * Heuristic SQL injection patterns — defense-in-depth only.
 * Prefer parameterized queries / ODM APIs; do not rely on these alone.
 *
 * Patterns intentionally avoid matching lone apostrophes in normal text
 * (e.g. "it's fine") to reduce false positives on global sanitization.
 */
export const SQL_INJECTION_PATTERNS: RegExp[] = [
  /((\%3D)|(=))[^\n]*((\%27)|(\')|(\-\-)|(\%3B)|(;))/i,
  /\w*((\%27)|(\'))((\%6F)|o|(\%4F))((\%72)|r|(\%52))/i,
  /((\%27)|(\'))\s*or\s+/i,
  /((\%27)|(\'))union/i,
  /\bunion(\s+all)?\s+select\b/i,
  /;\s*(drop|alter|create|truncate|insert|update|delete)\s+/i,
  /\/\*[\s\S]*?\*\//,
  /\bor\b\s+\d+\s*=\s*\d+/i,
  /\band\b\s+\d+\s*=\s*\d+/i,
  /\bsleep\s*\(/i,
  /\bbenchmark\s*\(/i,
  /\binformation_schema\b/i,
  /\bpg_sleep\s*\(/i,
  /\bxp_cmdshell\b/i,
  /(\%27)|(\')\s*(\-\-|\#|\%23)/i,
  /\-\-\s*$/,
];
