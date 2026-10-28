import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import {
  DEFAULT_REQUEST_DEADLINE_OPTIONS,
  REQUEST_DEADLINE_OPTIONS,
} from './constants/request-deadline.constants';
import { RequestDeadlineInterceptor } from './interceptors/request-deadline.interceptor';
import { RequestDeadlineMiddleware } from './middleware/request-deadline.middleware';
import { RequestDeadlineModuleOptions } from './types/request-deadline.types';
import { parsePositiveTimeoutMs } from './helpers/resolve-timeout-ms';

function sanitizeOptions(
  options: RequestDeadlineModuleOptions,
): Required<RequestDeadlineModuleOptions> {
  const defaultTimeoutMs = parsePositiveTimeoutMs(
    options.defaultTimeoutMs,
    DEFAULT_REQUEST_DEADLINE_OPTIONS.defaultTimeoutMs,
  );
  const maxTimeoutMs = Math.max(
    defaultTimeoutMs,
    parsePositiveTimeoutMs(
      options.maxTimeoutMs,
      DEFAULT_REQUEST_DEADLINE_OPTIONS.maxTimeoutMs,
    ),
  );
  return { defaultTimeoutMs, maxTimeoutMs };
}

@Global()
@Module({})
export class RequestDeadlineModule {
  static forRoot(options: RequestDeadlineModuleOptions = {}): DynamicModule {
    const merged = sanitizeOptions({
      ...DEFAULT_REQUEST_DEADLINE_OPTIONS,
      ...options,
    });

    return {
      module: RequestDeadlineModule,
      providers: [
        {
          provide: REQUEST_DEADLINE_OPTIONS,
          useValue: merged,
        },
        RequestDeadlineMiddleware,
        RequestDeadlineInterceptor,
      ],
      exports: [
        REQUEST_DEADLINE_OPTIONS,
        RequestDeadlineMiddleware,
        RequestDeadlineInterceptor,
      ],
    };
  }

  static forRootAsync(options: {
    imports?: DynamicModule['imports'];
    inject?: unknown[];
    useFactory: (
      ...args: unknown[]
    ) => RequestDeadlineModuleOptions | Promise<RequestDeadlineModuleOptions>;
  }): DynamicModule {
    const optionsProvider: Provider = {
      provide: REQUEST_DEADLINE_OPTIONS,
      useFactory: async (...args: unknown[]) => {
        const resolved = await options.useFactory(...args);
        return sanitizeOptions({
          ...DEFAULT_REQUEST_DEADLINE_OPTIONS,
          ...resolved,
        });
      },
      inject: (options.inject ?? []) as never[],
    };

    return {
      module: RequestDeadlineModule,
      imports: [...(options.imports ?? [])],
      providers: [
        optionsProvider,
        RequestDeadlineMiddleware,
        RequestDeadlineInterceptor,
      ],
      exports: [
        REQUEST_DEADLINE_OPTIONS,
        RequestDeadlineMiddleware,
        RequestDeadlineInterceptor,
      ],
    };
  }
}
