const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'cookie',
  'set-cookie',
]);

const SENSITIVE_HEADER_PATTERN =
  /(secret|token|password|api-?key|(?:^|[-_])key$|auth)/i;

const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'password',
  'passwd',
  'secret',
  'client_secret',
  'api_key',
  'apikey',
  'key',
  'sig',
  'signature',
  'credential',
]);

const SENSITIVE_QUERY_PATTERN =
  /(secret|token|password|passwd|api-?key|(?:^|[-_])key$|auth|sig|signature|credential)/i;

const SENSITIVE_LOG_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'set-cookie',
  'email',
  'phone',
  'mobile',
  'phonenumber',
  'ssn',
  'socialsecuritynumber',
  'creditcard',
  'cardnumber',
  'cvv',
  'secret',
  'apikey',
  'privatekey',
]);

const SENSITIVE_LOG_KEY_PATTERN =
  /(secret|token|password|passwd|api-?key|(?:^|[-_])key$|auth|credential|ssn|cvv)/i;

export function isSensitiveHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    SENSITIVE_HEADER_NAMES.has(lower) || SENSITIVE_HEADER_PATTERN.test(lower)
  );
}

export function isSensitiveQueryKey(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_QUERY_KEYS.has(lower) || SENSITIVE_QUERY_PATTERN.test(lower);
}

export function isSensitiveLogKey(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_LOG_KEYS.has(lower) || SENSITIVE_LOG_KEY_PATTERN.test(lower);
}
