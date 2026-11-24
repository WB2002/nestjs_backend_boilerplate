import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ConfiguredHttpClient,
  HttpClient,
  HttpError,
  exponentialBackoff,
  fullJitter,
} from '@/core/http-client';
import { ConformanceHttpClientRequestDto } from './dto';

export interface ConformanceHttpClientResponse {
  upstreamStatus: number;
  upstreamBody: unknown;
}

type HandledHttpClientErrorName =
  | 'CircuitOpenError'
  | 'TimeoutError'
  | 'RetryExhaustedError'
  | 'HttpError'
  | 'NetworkError';

function isHandledHttpClientErrorName(
  candidateName: string,
): candidateName is HandledHttpClientErrorName {
  return (
    candidateName === 'CircuitOpenError' ||
    candidateName === 'TimeoutError' ||
    candidateName === 'RetryExhaustedError' ||
    candidateName === 'HttpError' ||
    candidateName === 'NetworkError'
  );
}

@Injectable()
export class ConformanceHttpClientService implements OnModuleDestroy {
  private readonly configuredClients = new Map<string, ConfiguredHttpClient>();
  private readonly maxCacheEntries = 50;

  constructor(private readonly httpClient: HttpClient) {}

  async onModuleDestroy(): Promise<void> {
    const clients = [...this.configuredClients.values()];
    this.configuredClients.clear();
    await Promise.allSettled(clients.map((client) => client.close(1_000)));
  }

  async execute(
    request: ConformanceHttpClientRequestDto,
  ): Promise<ConformanceHttpClientResponse> {
    const client = this.getOrCreateClient(request);

    try {
      const httpResponse = await client.get(request.targetUrl);
      return {
        upstreamStatus: httpResponse.status,
        upstreamBody: httpResponse.body,
      };
    } catch (caughtError: unknown) {
      this.handleHttpClientError(caughtError);
    }
  }

  getClientCacheSize(): number {
    return this.configuredClients.size;
  }

  hasClientInCache(clientName: string): boolean {
    return this.configuredClients.has(clientName);
  }

  private getOrCreateClient(
    request: ConformanceHttpClientRequestDto,
  ): ConfiguredHttpClient {
    const existingClient = this.configuredClients.get(request.clientName);
    if (existingClient) {
      this.configuredClients.delete(request.clientName);
      this.configuredClients.set(request.clientName, existingClient);
      return existingClient;
    }

    if (this.configuredClients.size >= this.maxCacheEntries) {
      const oldestEntry = this.configuredClients.entries().next();
      if (!oldestEntry.done) {
        const [oldestKey, oldestClient] = oldestEntry.value;
        this.configuredClients.delete(oldestKey);
        void oldestClient.close(1_000);
      }
    }

    const newClient = this.buildClient(request);
    this.configuredClients.set(request.clientName, newClient);
    return newClient;
  }

  private buildClient(
    request: ConformanceHttpClientRequestDto,
  ): ConfiguredHttpClient {
    const targetUrl = new URL(request.targetUrl);
    let client =
      request.clientKind === 'internal'
        ? this.httpClient.internal(request.clientName)
        : this.httpClient.external(request.clientName);

    client = client.addBaseUrl(targetUrl.origin);

    if (request.maxRetries !== undefined) {
      client = client.addRetry({
        maxAttempts: request.maxRetries + 1,
        backoff: exponentialBackoff({
          baseDelay: request.baseDelayMs ?? 50,
        }),
        jitter: fullJitter(),
      });
    }

    if (request.circuitBreakerFailureThreshold !== undefined) {
      client = client.addCircuitBreaker({
        failureThreshold: request.circuitBreakerFailureThreshold,
        resetTimeout: request.circuitBreakerResetTimeoutMs ?? 1000,
      });
    }

    if (request.shouldCoalesce) {
      client = client.addRequestCoalescing();
    }

    if (request.maxConcurrent !== undefined) {
      client = client.addConcurrencyLimit({
        mode: request.concurrencyMode ?? 'fixed',
        maxConcurrent: request.maxConcurrent,
      });
    }

    if (request.shouldPropagateDeadline) {
      client = client.addDeadlinePropagation({ propagateHeader: true });
    }

    if (request.timeoutMs !== undefined) {
      client = client.addTimeout({ timeoutMs: request.timeoutMs });
    }

    return client;
  }

  private handleHttpClientError(caughtError: unknown): never {
    if (
      caughtError instanceof Error &&
      isHandledHttpClientErrorName(caughtError.name)
    ) {
      const errorName = caughtError.name;
      switch (errorName) {
        case 'CircuitOpenError':
          throw new ServiceUnavailableException({
            errorName: caughtError.name,
            errorMessage: caughtError.message,
          });
        case 'TimeoutError':
          throw new GatewayTimeoutException({
            errorName: caughtError.name,
            errorMessage: caughtError.message,
          });
        case 'RetryExhaustedError':
        case 'NetworkError':
          throw new BadGatewayException({
            errorName: caughtError.name,
            errorMessage: caughtError.message,
          });
        case 'HttpError':
          throw new BadGatewayException({
            errorName: caughtError.name,
            errorMessage: caughtError.message,
            statusCode: (caughtError as HttpError).status,
          });
        default: {
          const _never: never = errorName;
          throw new Error(`Unhandled HTTP client error: ${_never}`);
        }
      }
    }
    throw caughtError;
  }
}
