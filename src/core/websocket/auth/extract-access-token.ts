import { ACCESS_TOKEN_COOKIE } from '@/common/constants';

export type HandshakeTokenSource = {
  headers: {
    cookie?: string | undefined;
    authorization?: string | undefined;
  };
  auth?: Record<string, unknown>;
  query?: Record<string, unknown>;
};

export type ExtractAccessTokenOptions = {
  allowQueryToken: boolean;
};

function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq);
    if (key !== name) {
      continue;
    }
    const value = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

export function extractAccessToken(
  handshake: HandshakeTokenSource,
  options: ExtractAccessTokenOptions,
): string | null {
  const authHeader = handshake.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice('Bearer '.length).trim();
    if (bearer) {
      return bearer;
    }
  }

  const cookieToken = readCookie(handshake.headers.cookie, ACCESS_TOKEN_COOKIE);
  if (cookieToken) {
    return cookieToken;
  }

  const authToken = handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.trim()) {
    return authToken.trim();
  }

  if (options.allowQueryToken) {
    const queryToken = handshake.query?.access_token;
    if (typeof queryToken === 'string' && queryToken.trim()) {
      return queryToken.trim();
    }
  }

  return null;
}
