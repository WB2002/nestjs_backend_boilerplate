import { Injectable, NestMiddleware } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { LoggerContext } from './logger.context';
import { IRequest, IResponse } from '@/types';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: IRequest, res: IResponse, next: (error?: Error) => void) {
    const requestId = (req.headers['x-request-id'] as string) || uuidv4();
    const userId = req.user?.id || 'anonymous';

    LoggerContext.run({ requestId, userId }, () => {
      res.setHeader('x-request-id', requestId);
      next();
    });
  }
}
