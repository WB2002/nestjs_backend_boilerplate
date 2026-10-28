import { DynamicModule, Global, Module } from '@nestjs/common';
import {
  CSRF_OPTIONS,
  DEFAULT_CSRF_OPTIONS,
} from './constants/csrf.constants';
import { CsrfMiddleware } from './middleware/csrf.middleware';
import { CsrfTokenService } from './csrf-token.service';
import { CsrfModuleOptions } from './types/csrf.types';

function mergeOptions(
  options: CsrfModuleOptions = {},
): Required<CsrfModuleOptions> {
  return {
    enabled: options.enabled ?? DEFAULT_CSRF_OPTIONS.enabled,
    cookieName: options.cookieName ?? DEFAULT_CSRF_OPTIONS.cookieName,
    headerName: options.headerName ?? DEFAULT_CSRF_OPTIONS.headerName,
    exemptPaths: options.exemptPaths ?? DEFAULT_CSRF_OPTIONS.exemptPaths,
  };
}

@Global()
@Module({})
export class CsrfModule {
  static forRoot(options: CsrfModuleOptions = {}): DynamicModule {
    const merged = mergeOptions(options);
    return {
      module: CsrfModule,
      providers: [
        { provide: CSRF_OPTIONS, useValue: merged },
        CsrfTokenService,
        CsrfMiddleware,
      ],
      exports: [CSRF_OPTIONS, CsrfTokenService, CsrfMiddleware],
    };
  }

  static forRootAsync(options: {
    inject?: unknown[];
    useFactory: (
      ...args: unknown[]
    ) => CsrfModuleOptions | Promise<CsrfModuleOptions>;
  }): DynamicModule {
    return {
      module: CsrfModule,
      providers: [
        {
          provide: CSRF_OPTIONS,
          useFactory: async (...args: unknown[]) =>
            mergeOptions(await options.useFactory(...args)),
          inject: (options.inject ?? []) as never[],
        },
        CsrfTokenService,
        CsrfMiddleware,
      ],
      exports: [CSRF_OPTIONS, CsrfTokenService, CsrfMiddleware],
    };
  }
}
