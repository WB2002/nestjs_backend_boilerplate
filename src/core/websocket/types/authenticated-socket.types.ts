import type { AuthenticatedUser } from '@/auth/types/authenticated-user.types';
import type { Socket } from 'socket.io';

export type AuthenticatedSocketData = {
  user?: AuthenticatedUser;
  wsConnectionRegistered?: boolean;
};

export type AuthenticatedSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  AuthenticatedSocketData
>;
