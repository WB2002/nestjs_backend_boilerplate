import { DnsCache } from '../transport/dns-cache';
import * as http from 'http';
import * as https from 'https';

export interface AgentBundle {
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
  dnsCache?: DnsCache;
  release(): void;
}

export interface SharedPoolEntry {
  key: string;
  refCount: number;
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
  dnsCache?: DnsCache;
}
