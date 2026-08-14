import { FastifyRequest } from 'fastify';

export function resolveUserTracker(req: FastifyRequest): string | null {
  const user = (req as FastifyRequest & { user?: { id?: string; _id?: string } })
    .user;
  const id = user?.id ?? user?._id;
  return id ? String(id) : null;
}
