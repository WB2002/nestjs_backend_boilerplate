import type {
  AuthPolicy,
  CachedToken,
  HttpRequest,
  OAuthClientCredentialsPolicy,
} from '../types';
import { HttpError, NetworkError } from '../errors';
import type { AxiosTransport } from '../transport/axios-transport';

export class OAuthTokenManager {
  private cached?: CachedToken;
  private inflight?: Promise<CachedToken>;

  constructor(
    private readonly policy: OAuthClientCredentialsPolicy,
    private readonly transport: AxiosTransport,
  ) {
    if (
      !policy.allowInsecureTokenUrl &&
      new URL(policy.tokenUrl).protocol !== 'https:'
    ) {
      throw new Error('OAuth tokenUrl must use HTTPS');
    }
  }

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) {
      return this.cached.accessToken;
    }
    const token = await this.acquire(false);
    return token.accessToken;
  }

  async refresh(): Promise<string> {
    delete this.cached;
    const token = await this.acquire(true);
    return token.accessToken;
  }

  clear(): void {
    delete this.cached;
    delete this.inflight;
  }

  private async acquire(shouldForceRefresh = false): Promise<CachedToken> {
    if (
      !shouldForceRefresh &&
      this.cached &&
      this.cached.expiresAt > Date.now()
    ) {
      return this.cached;
    }

    if (this.inflight) {
      if (!shouldForceRefresh) {
        return this.inflight;
      }
      // Force refresh: wait for the current flight, then start one new fetch.
      try {
        await this.inflight;
      } catch {
        // Ignore prior failure; refresh starts a new fetch below.
      }
    }

    // Another caller may have started a fetch while we awaited (single-threaded resume).
    if (this.inflight) {
      return this.inflight;
    }

    if (
      !shouldForceRefresh &&
      this.cached &&
      this.cached.expiresAt > Date.now()
    ) {
      return this.cached;
    }

    const fetchPromise = this.fetchToken();
    this.inflight = fetchPromise;
    try {
      return await fetchPromise;
    } finally {
      if (this.inflight === fetchPromise) {
        delete this.inflight;
      }
    }
  }

  private async fetchToken(): Promise<CachedToken> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.policy.clientId,
      client_secret: this.policy.clientSecret,
    });
    if (this.policy.scope) {
      body.set('scope', this.policy.scope);
    }
    if (this.policy.audience) {
      body.set('audience', this.policy.audience);
    }
    if (this.policy.extraTokenParams) {
      for (const [key, value] of Object.entries(this.policy.extraTokenParams)) {
        body.set(key, value);
      }
    }

    const response = await this.transport.bareRequest<{
      access_token?: string;
      expires_in?: number;
      token_type?: string;
    }>({
      method: 'POST',
      url: this.policy.tokenUrl,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      // Axios request config uses `data` for the body field.
      // eslint-disable-next-line id-denylist -- Axios API
      data: body.toString(),
      timeout: 10_000,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new HttpError(
        `OAuth token request failed with HTTP ${response.status}`,
        {
          status: response.status,
          responseBody: response.data,
        },
      );
    }

    const accessToken = response.data?.access_token;
    if (!accessToken) {
      throw new NetworkError('OAuth token response missing access_token');
    }

    const expiresInSec = response.data.expires_in ?? 3600;
    const skewMs = this.policy.skewMs ?? 60_000;
    this.cached = {
      accessToken,
      expiresAt: Date.now() + expiresInSec * 1000 - skewMs,
    };
    return this.cached;
  }
}

export async function applyAuth(
  request: HttpRequest,
  auth: AuthPolicy | undefined,
  oauth?: OAuthTokenManager,
): Promise<HttpRequest> {
  if (!auth) {
    return request;
  }

  const headers = { ...(request.headers ?? {}) };

  switch (auth.type) {
    case 'apiKey': {
      const header = auth.header ?? 'x-api-key';
      headers[header] = auth.prefix ? `${auth.prefix}${auth.key}` : auth.key;
      break;
    }
    case 'basic': {
      const token = Buffer.from(`${auth.username}:${auth.password}`).toString(
        'base64',
      );
      headers.Authorization = `Basic ${token}`;
      break;
    }
    case 'bearer': {
      headers.Authorization = `Bearer ${auth.token}`;
      break;
    }
    case 'oauth': {
      if (!oauth) {
        throw new Error('OAuth token manager is not configured');
      }
      const accessToken = await oauth.getAccessToken();
      headers.Authorization = `Bearer ${accessToken}`;
      break;
    }
    default:
      break;
  }

  return { ...request, headers };
}

export function assertCompatibleAuth(auth?: AuthPolicy): void {
  if (!auth) {
    return;
  }
  if (auth.type === 'oauth' && auth.grantType !== 'client_credentials') {
    throw new Error('Only OAuth client_credentials grant is supported');
  }
}
