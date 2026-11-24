import {
  Inject,
  Injectable,
  NestMiddleware,
  OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import {
  DEFAULT_GUEST_COOKIE_MAX_AGE,
  DEFAULT_GUEST_COOKIE_NAME,
  GUEST_ID_UUID_V4_RE,
  RATE_LIMIT_OPTIONS,
} from '../constants/rate-limit.constants';
import { RateLimiterModuleOptions } from '../types/rate-limit.types';
import { isHealthProbePath } from '@/common/http/health-probe-paths';
import { mergeCookieRecord, readCookieField } from '@/common/utils';

/**
 * Mints a secure signed `guest_id` cookie on first visit.
 * Nest MiddlewareConsumer registers this class; real minting runs on Fastify `onRequest`
 * so `reply.setCookie` / signed cookies work correctly.
 */
@Injectable()
export class GuestIdMiddleware implements NestMiddleware, OnModuleInit {
  private isHookRegistered = false;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(RATE_LIMIT_OPTIONS)
    private readonly options: RateLimiterModuleOptions,
  ) {}

  onModuleInit(): void {
    if (this.isHookRegistered) {
      return;
    }
    const instance =
      this.httpAdapterHost.httpAdapter.getInstance() as FastifyInstance;
    instance.addHook('onRequest', async (req, reply) => {
      if (typeof req.url === 'string' && isHealthProbePath(req.url)) {
        return;
      }
      this.ensureGuestId(req, reply);
    });
    this.isHookRegistered = true;
  }

  /** Nest wiring only — cookie work is in the Fastify onRequest hook. */
  use(_req: IncomingMessage, _res: ServerResponse, next: () => void): void {
    next();
  }

  ensureGuestId(req: FastifyRequest, reply: FastifyReply): string {
    const cookieName =
      this.options.guestCookie?.name ?? DEFAULT_GUEST_COOKIE_NAME;
    const existing = this.readValidGuestId(req, cookieName);
    if (existing) {
      // Normalize to unsigned UUID for rate-limit resolvers.
      (req as FastifyRequest & { cookies: Record<string, string> }).cookies =
        mergeCookieRecord(req.cookies, cookieName, existing);
      return existing;
    }

    return this.mintGuestId(req, reply, cookieName);
  }

  readValidGuestId(req: FastifyRequest, cookieName: string): string | null {
    const raw = readCookieField(req.cookies, cookieName);
    if (!raw) {
      return null;
    }

    let value = raw;
    if (typeof req.unsignCookie === 'function') {
      const unsigned = req.unsignCookie(raw);
      if (!unsigned.valid || !unsigned.value) {
        return null;
      }
      value = unsigned.value;
    }

    if (!GUEST_ID_UUID_V4_RE.test(value)) {
      return null;
    }
    return value;
  }

  private mintGuestId(
    req: FastifyRequest,
    reply: FastifyReply,
    cookieName: string,
  ): string {
    const guestId = randomUUID();
    const maxAge =
      this.options.guestCookie?.maxAge ?? DEFAULT_GUEST_COOKIE_MAX_AGE;
    const sameSite = this.options.guestCookie?.sameSite ?? 'lax';
    // Spec: Secure by default; override with guestCookie.secure: false for local HTTP.
    const isSecure = this.options.guestCookie?.secure ?? true;
    const isHttpOnly = this.options.guestCookie?.httpOnly ?? true;
    const path = this.options.guestCookie?.path ?? '/';

    reply.setCookie(cookieName, guestId, {
      httpOnly: isHttpOnly,
      secure: isSecure,
      sameSite,
      path,
      maxAge,
      signed: true,
    });

    (req as FastifyRequest & { cookies: Record<string, string> }).cookies =
      mergeCookieRecord(req.cookies, cookieName, guestId);
    return guestId;
  }
}
