import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ConformanceHarnessAuthGuard } from './guards/conformance-harness-auth.guard';
import { assertLoopbackTargetUrl } from './assert-loopback-target-url';
import {
  ConformanceHttpClientResponse,
  ConformanceHttpClientService,
} from './conformance-http-client.service';
import { ConformanceHttpClientRequestDto } from './dto';

/** Harness JSON payloads validated with class-validator DTOs. */
@UseGuards(ConformanceHarnessAuthGuard)
@Controller('conformance/http-client')
export class ConformanceHttpClientController {
  constructor(
    private readonly conformanceHttpClientService: ConformanceHttpClientService,
  ) {}

  @Post()
  @HttpCode(200)
  execute(
    @Body() request: ConformanceHttpClientRequestDto,
  ): Promise<ConformanceHttpClientResponse> {
    assertLoopbackTargetUrl(request.targetUrl);
    return this.conformanceHttpClientService.execute(request);
  }
}
