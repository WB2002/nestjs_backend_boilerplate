import { SQL_INJECTION_PATTERNS } from '../constants';

/**
 * Heuristic SQL injection detection — defense-in-depth only.
 * Prefer parameterized queries / ODM APIs; do not rely on this alone.
 * Use @SkipSqlInjectionCheck() for rich prose fields that may include
 * words like "union" in non-SQL contexts.
 */
export function looksLikeSqlInjection(value: string): boolean {
  if (!value || value.length < 2) {
    return false;
  }
  return SQL_INJECTION_PATTERNS.some((pattern) => pattern.test(value));
}
