import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { FastifyRequest } from 'fastify';

function readBearerToken(authorizationHeader: string | undefined): string {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedException('Missing conformance harness token');
  }
  const token = authorizationHeader.slice('Bearer '.length).trim();
  if (!token) {
    throw new UnauthorizedException('Missing conformance harness token');
  }
  return token;
}

function tokensMatch(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

@Injectable()
export class ConformanceHarnessAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const expectedToken =
      this.configService.get<string>('CONFORMANCE_HARNESS_TOKEN') ?? '';
    if (!expectedToken) {
      throw new UnauthorizedException('Conformance harness is not configured');
    }
    const providedToken = readBearerToken(request.headers.authorization);
    if (!tokensMatch(expectedToken, providedToken)) {
      throw new UnauthorizedException('Invalid conformance harness token');
    }
    return true;
  }
}
