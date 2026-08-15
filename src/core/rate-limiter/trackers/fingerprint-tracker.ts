import { createHash } from 'crypto';
import { FastifyRequest } from 'fastify';
import { MissingFingerprintError } from '../errors/missing-fingerprint.error';
import { DEFAULT_FINGERPRINT_HEADER } from '../constants/rate-limit.constants';
import { RateLimiterModuleOptions } from '../types/rate-limit.types';

export function resolveFingerprintTracker(
  req: FastifyRequest,
  options: RateLimiterModuleOptions,
): string {
  const fingerprintHeader =
    options.fingerprintHeader ?? DEFAULT_FINGERPRINT_HEADER;
  const header = req.headers[fingerprintHeader.toLowerCase()];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    throw new MissingFingerprintError();
  }
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}
