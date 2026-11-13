import { BadRequestException } from '@nestjs/common';

const ALLOWED_LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  '127.0.0.1',
  'localhost',
]);

export function assertLoopbackTargetUrl(rawUrl: string): URL {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new BadRequestException(
      'targetUrl must be http://127.0.0.1 or http://localhost',
    );
  }

  const isHttpProtocol = parsedUrl.protocol === 'http:';
  const isAllowedHost = ALLOWED_LOOPBACK_HOSTNAMES.has(parsedUrl.hostname);
  const hasNoCredentials =
    parsedUrl.username === '' && parsedUrl.password === '';

  if (!isHttpProtocol || !isAllowedHost || !hasNoCredentials) {
    throw new BadRequestException(
      'targetUrl must be http://127.0.0.1 or http://localhost',
    );
  }

  return parsedUrl;
}
