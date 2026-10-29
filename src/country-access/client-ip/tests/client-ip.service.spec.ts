import { ClientIpService } from '../client-ip.service';
import type { FastifyRequest } from 'fastify';

function mockRequest(ip: string | undefined): FastifyRequest {
  return { ip } as FastifyRequest;
}

describe('ClientIpService', () => {
  const service = new ClientIpService();

  it('returns direct client IPv4', () => {
    expect(service.resolve(mockRequest('203.0.113.10'))).toBe('203.0.113.10');
  });

  it('returns direct client IPv6', () => {
    expect(service.resolve(mockRequest('2001:db8::1'))).toBe('2001:db8::1');
  });

  it('normalizes IPv4-mapped IPv6', () => {
    expect(service.resolve(mockRequest('::ffff:203.0.113.10'))).toBe(
      '203.0.113.10',
    );
  });

  it('strips brackets and zone ids', () => {
    expect(service.resolve(mockRequest('[2001:db8::1]'))).toBe('2001:db8::1');
    expect(service.resolve(mockRequest('fe80::1%lo0'))).toBe('fe80::1');
  });

  it('returns null for missing or invalid IP', () => {
    expect(service.resolve(mockRequest(undefined))).toBeNull();
    expect(service.resolve(mockRequest(''))).toBeNull();
    expect(service.resolve(mockRequest('not-an-ip'))).toBeNull();
  });
});
