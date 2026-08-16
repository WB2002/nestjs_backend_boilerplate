import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Throttle({ default: { limit: 3, ttl: 60000 } }) // Limit to 3 requests per minute for this specific route
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
