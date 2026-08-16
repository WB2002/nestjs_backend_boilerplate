import * as http from 'http';
import * as https from 'https';
import type * as dns from 'dns';
import type {
  ConnectionPoolPolicy,
  DnsPolicy,
  MtlsPolicy,
  TlsPolicy,
} from '../types';
import { DnsCache } from './dns-cache';
import { withoutUndefined } from '../utils/without-undefined';
import { hashCa, hashMaterial } from '../utils/fingerprint';
import { AgentBundle, SharedPoolEntry } from '../types/connection-pool.types';



export function poolKey(options: {
  mode: string;
  keepAlive?: boolean;
  maxSockets?: number;
  maxFreeSockets?: number;
  keepAliveMsecs?: number;
  timeout?: number;
  tls?: TlsPolicy;
  mtls?: MtlsPolicy;
  dns?: DnsPolicy;
}): string {
  return JSON.stringify({
    mode: options.mode,
    keepAlive: options.keepAlive ?? true,
    maxSockets: options.maxSockets ?? 50,
    maxFreeSockets: options.maxFreeSockets ?? 10,
    keepAliveMsecs: options.keepAliveMsecs ?? 1000,
    timeout: options.timeout,
    tls: options.tls,
    mtls: options.mtls
      ? {
          cert: hashMaterial(options.mtls.cert),
          key: hashMaterial(options.mtls.key),
          passphrase: hashMaterial(options.mtls.passphrase),
          ca: hashCa(options.mtls.ca),
        }
      : undefined,
    dns: options.dns,
  });
}

export class ConnectionPoolRegistry {
  private readonly shared = new Map<string, SharedPoolEntry>();

  acquire(options: {
    connectionPool: ConnectionPoolPolicy;
    tls?: TlsPolicy;
    mtls?: MtlsPolicy;
    dns?: DnsPolicy;
  }): AgentBundle {
    const { connectionPool, tls, mtls, dns } = options;
    if (connectionPool.mode === 'dedicated') {
      return this.createDedicatedBundle(
        withoutUndefined({ connectionPool, tls, mtls, dns }),
      );
    }

    const { mode: _mode, ...poolRest } = connectionPool;
    const key = poolKey(
      withoutUndefined({
        mode: 'shared',
        ...poolRest,
        tls,
        mtls,
        dns,
      }),
    );
    const existing = this.shared.get(key);
    if (existing) {
      existing.refCount += 1;
      return this.leaseShared(existing);
    }

    const agents = this.createAgents(
      withoutUndefined({ connectionPool, tls, mtls, dns }),
    );
    const entry: SharedPoolEntry = {
      key,
      refCount: 1,
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
      ...(agents.dnsCache ? { dnsCache: agents.dnsCache } : {}),
    };
    this.shared.set(key, entry);
    return this.leaseShared(entry);
  }

  /** Visible for tests: current shared pool ref counts by key. */
  getSharedRefCount(key: string): number {
    return this.shared.get(key)?.refCount ?? 0;
  }

  async closeAll(): Promise<void> {
    for (const entry of this.shared.values()) {
      entry.httpAgent.destroy();
      entry.httpsAgent.destroy();
      entry.dnsCache?.clear();
    }
    this.shared.clear();
  }

  private leaseShared(entry: SharedPoolEntry): AgentBundle {
    let released = false;
    return withoutUndefined({
      httpAgent: entry.httpAgent,
      httpsAgent: entry.httpsAgent,
      dnsCache: entry.dnsCache,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        entry.refCount -= 1;
        if (entry.refCount <= 0) {
          entry.httpAgent.destroy();
          entry.httpsAgent.destroy();
          entry.dnsCache?.clear();
          this.shared.delete(entry.key);
        }
      },
    }) as AgentBundle;
  }

  private createDedicatedBundle(options: {
    connectionPool: ConnectionPoolPolicy;
    tls?: TlsPolicy;
    mtls?: MtlsPolicy;
    dns?: DnsPolicy;
  }): AgentBundle {
    const agents = this.createAgents(options);
    let released = false;
    return withoutUndefined({
      ...agents,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        agents.httpAgent.destroy();
        agents.httpsAgent.destroy();
        agents.dnsCache?.clear();
      },
    }) as AgentBundle;
  }

  private createAgents(options: {
    connectionPool: ConnectionPoolPolicy;
    tls?: TlsPolicy;
    mtls?: MtlsPolicy;
    dns?: DnsPolicy;
  }): {
    httpAgent: http.Agent;
    httpsAgent: https.Agent;
    dnsCache?: DnsCache;
  } {
    const { connectionPool, tls, mtls, dns } = options;
    const dnsCache =
      dns?.lookupCacheTtlMs != null
        ? new DnsCache(
            withoutUndefined({
              ttlMs: dns.lookupCacheTtlMs,
              family: dns.family,
              hints: dns.hints,
            }),
          )
        : undefined;

    const common = withoutUndefined({
      keepAlive: connectionPool.keepAlive ?? true,
      maxSockets: connectionPool.maxSockets ?? 50,
      maxFreeSockets: connectionPool.maxFreeSockets ?? 10,
      keepAliveMsecs: connectionPool.keepAliveMsecs ?? 1000,
      timeout: connectionPool.timeout,
      lookup: dnsCache
        ? (((
            hostname: string,
            options: unknown,
            callback: (
              err: NodeJS.ErrnoException | null,
              address: string,
              family: number,
            ) => void,
          ) => {
            dnsCache.lookup(
              hostname,
              options as dns.LookupOneOptions,
              callback,
            );
          }) as http.AgentOptions['lookup'])
        : undefined,
    });

    const httpAgent = new http.Agent(common);
    const httpsAgent = new https.Agent(
      withoutUndefined({
        ...common,
        rejectUnauthorized: tls?.rejectUnauthorized ?? true,
        ca: mtls?.ca ?? tls?.ca,
        cert: mtls?.cert,
        key: mtls?.key,
        passphrase: mtls?.passphrase,
        ...(tls?.minVersion ? { minVersion: tls.minVersion } : {}),
        ...(tls?.maxVersion ? { maxVersion: tls.maxVersion } : {}),
        servername: tls?.servername,
      }) as https.AgentOptions,
    );

    return withoutUndefined({
      httpAgent,
      httpsAgent,
      dnsCache,
    }) as {
      httpAgent: http.Agent;
      httpsAgent: https.Agent;
      dnsCache?: DnsCache;
    };
  }
}
export { AgentBundle };

