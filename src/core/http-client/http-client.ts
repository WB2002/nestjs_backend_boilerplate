import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfiguredHttpClient } from './configured-http-client';
import { createDefaultPolicy, type ClientKind } from './types';
import { RuntimeRegistry } from './runtime/runtime-registry';
import { ConnectionPoolRegistry } from './transport/connection-pool.registry';

@Injectable()
export class HttpClient implements OnApplicationShutdown {
  private readonly poolRegistry = new ConnectionPoolRegistry();
  private readonly runtimeRegistry = new RuntimeRegistry(this.poolRegistry);
  private closed = false;
  private readonly shutdownGraceMs = 10_000;

  internal(serviceName: string): ConfiguredHttpClient {
    return this.create('internal', serviceName);
  }

  external(serviceName: string): ConfiguredHttpClient {
    return this.create('external', serviceName);
  }

  async close(graceMs = this.shutdownGraceMs): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.runtimeRegistry.close(graceMs);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  private create(kind: ClientKind, serviceName: string): ConfiguredHttpClient {
    if (this.closed) {
      throw new Error('HttpClient is closed');
    }
    if (!serviceName?.trim()) {
      throw new Error('serviceName is required');
    }
    return new ConfiguredHttpClient(
      createDefaultPolicy({ kind, serviceName }),
      this.runtimeRegistry,
    );
  }
}
