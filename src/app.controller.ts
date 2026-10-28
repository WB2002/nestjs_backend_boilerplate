import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import {
  RateLimit,
  RateLimitAlgorithm,
  RateLimitIdentifier,
} from './core/rate-limiter';

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
