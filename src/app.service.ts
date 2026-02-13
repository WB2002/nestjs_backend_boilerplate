import { Injectable, Logger } from '@nestjs/common';
import { Trace } from './common/logger/trace.decorator';


@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  @Trace()
  getHello(): string {
    this.logger.log('appservice')
    return 'Hello World!';
  }
}

