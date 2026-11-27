import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from '@/common/decorators';
import {
  RateLimit,
  RateLimitAlgorithm,
  RateLimitIdentifier,
} from './core/rate-limiter';

/** Health-style root probe; no request body (global ValidationPipe uses class-validator on mutating routes). */
@Public()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @RateLimit({
    algorithm: RateLimitAlgorithm.FixedWindowCounter,
    methods: [
      {
        name: 'hello-ip',
        identifier: RateLimitIdentifier.Ip,
        duration: 60_000,
        limit: 3,
      },
    ],
  })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
