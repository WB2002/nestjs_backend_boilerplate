import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { IRequest, IResponse } from '@/types';
import { isHealthProbePath } from '@/common/http/health-probe-paths';
import { redactUrl } from '@/core/redaction';
import { parseLogRedactionConfig } from '@/core/redaction/parse-log-redaction-config';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);
  private readonly isRedactionEnabled = parseLogRedactionConfig(process.env)
    .enabled;

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const ctx = context.switchToHttp();
    const req = ctx.getRequest<IRequest>();
    const { method, url } = req;
    if (typeof url === 'string' && isHealthProbePath(url)) {
      return next.handle();
    }

    const res = ctx.getResponse<IResponse>();
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const statusCode = res.statusCode;
        const delay = Date.now() - now;

        const safeUrl =
          this.isRedactionEnabled && typeof url === 'string'
            ? redactUrl(url)
            : url;
        this.logger.log(`${method} ${safeUrl} ${statusCode} - ${delay}ms`);
      }),
    );
  }
}
