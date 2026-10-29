const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

const JWT_PATTERN = /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function looksLikeSensitiveValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (EMAIL_PATTERN.test(trimmed)) {
    return true;
  }
  if (JWT_PATTERN.test(trimmed)) {
    return true;
  }
  return false;
}
