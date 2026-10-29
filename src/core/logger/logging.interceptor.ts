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
import { redactUrl } from '@/core/redaction';
import { parseLogRedactionConfig } from '@/core/redaction/parse-log-redaction-config';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);
  private readonly redactionEnabled = parseLogRedactionConfig(process.env)
    .enabled;

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const ctx = context.switchToHttp();
    const req = ctx.getRequest<IRequest>();
    const res = ctx.getResponse<IResponse>();
    const { method, url } = req;
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const statusCode = res.statusCode;
        const delay = Date.now() - now;

        const safeUrl =
          this.redactionEnabled && typeof url === 'string'
            ? redactUrl(url)
            : url;
        this.logger.log(`${method} ${safeUrl} ${statusCode} - ${delay}ms`);
      }),
    );
  }
}
