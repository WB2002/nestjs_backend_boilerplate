import { Injectable, Logger } from '@nestjs/common';
import { Trace } from './common/logger/trace.decorator';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  getHello(): string {
    return 'Hello World!';
  }
}
