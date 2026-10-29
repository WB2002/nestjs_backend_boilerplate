import {
  Inject,
  Injectable,
  NestMiddleware,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { IncomingMessage, ServerResponse } from 'http';
import {
  CSRF_OPTIONS,
  DEFAULT_CSRF_OPTIONS,
} from '../constants/csrf.constants';
import { CsrfForbiddenError } from '../errors/csrf-forbidden.error';
import { CsrfTokenService } from '../csrf-token.service';
import { isCsrfExemptPath } from '../helpers/is-csrf-exempt-path';
import { shouldEnforceCsrf } from '../helpers/should-enforce-csrf';
import { CsrfModuleOptions } from '../types/csrf.types';
import { readStringRecordField } from '@/common/utils';

@Injectable()
export class CsrfMiddleware implements NestMiddleware, OnModuleInit {
  private isHookRegistered = false;
  private readonly options: Required<CsrfModuleOptions>;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly csrfTokenService: CsrfTokenService,
    @Optional() @Inject(CSRF_OPTIONS) options?: CsrfModuleOptions,
  ) {
    this.options = {
      enabled: options?.enabled ?? DEFAULT_CSRF_OPTIONS.enabled,
      cookieName: options?.cookieName ?? DEFAULT_CSRF_OPTIONS.cookieName,
      headerName: options?.headerName ?? DEFAULT_CSRF_OPTIONS.headerName,
      exemptPaths: options?.exemptPaths ?? DEFAULT_CSRF_OPTIONS.exemptPaths,
    };
  }

  onModuleInit(): void {
    if (this.isHookRegistered) {
      return;
    }
    const instance =
      this.httpAdapterHost.httpAdapter.getInstance() as FastifyInstance;
    instance.addHook('onRequest', async (req, reply) => {
      this.enforceOnRequest(req, reply);
    });
    this.isHookRegistered = true;
  }

  /** Nest wiring only — validation runs on Fastify `onRequest` after cookies parse. */
  use(_req: IncomingMessage, _res: ServerResponse, next: () => void): void {
    next();
  }

  enforceOnRequest(req: FastifyRequest, reply: FastifyReply): void {
    if (!this.options.enabled) {
      return;
    }

    const url = typeof req.url === 'string' ? req.url : '';
    if (isCsrfExemptPath(url, this.options.exemptPaths)) {
      return;
    }

    const enforceInput: {
      method?: string;
      headers?: Record<string, unknown>;
      cookies?: Record<string, string>;
    } = {
      method: req.method,
      headers: req.headers as Record<string, unknown>,
    };
    if (req.cookies) {
      enforceInput.cookies = req.cookies as Record<string, string>;
    }
    if (!shouldEnforceCsrf(enforceInput)) {
      return;
    }

    const cookieToken = req.cookies?.[this.options.cookieName];
    const headerToken = this.readHeader(req, this.options.headerName);

    if (!this.csrfTokenService.tokensMatch(cookieToken, headerToken)) {
      const body = new CsrfForbiddenError().getResponse() as Record<
        string,
        unknown
      >;
      reply.code(403).send(body);
    }
  }

  private readHeader(req: FastifyRequest, name: string): string | undefined {
    const headers = req.headers as Record<string, unknown>;
    return (
      readStringRecordField(headers, name) ??
      readStringRecordField(headers, name.toLowerCase())
    );
  }
}
