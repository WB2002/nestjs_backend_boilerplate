import { Injectable } from '@nestjs/common';
import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

/**
 * Resolves the trusted client IP from Fastify's `request.ip`.
 * Forwarded-header trust is controlled exclusively by Fastify `trustProxy`
 * (see TRUST_PROXY in main.ts). This service never reads X-Forwarded-For.
 */
@Injectable()
export class ClientIpService {
  resolve(request: FastifyRequest): string | null {
    const raw = request.ip?.trim();
    if (!raw) {
      return null;
    }
    const normalized = this.normalizeIp(raw);
    if (!normalized || isIP(normalized) === 0) {
      return null;
    }
    return normalized;
  }

  private normalizeIp(ip: string): string {
    let value = ip;
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1);
    }
    // Strip optional zone id (fe80::1%eth0)
    const zoneIndex = value.indexOf('%');
    if (zoneIndex >= 0) {
      value = value.slice(0, zoneIndex);
    }
    // IPv4-mapped IPv6 → dotted IPv4
    if (value.toLowerCase().startsWith('::ffff:')) {
      const mapped = value.slice('::ffff:'.length);
      if (isIP(mapped) === 4) {
        return mapped;
      }
    }
    return value;
  }
}
