import { ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

export function getHttpRequest(context: ExecutionContext): FastifyRequest {
  return context.switchToHttp().getRequest<FastifyRequest>();
}
