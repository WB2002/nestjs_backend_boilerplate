import { FastifyRequest } from 'fastify';
import { User } from '../schemas/user.schema';

export interface AuthRequest extends FastifyRequest {
  user: User & { jti: string };
}
