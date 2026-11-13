import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Public } from '@/common/decorators';
import { assertLoopbackTargetUrl } from './assert-loopback-target-url';
import {
  ConformanceHttpClientResponse,
  ConformanceHttpClientService,
} from './conformance-http-client.service';
import { ConformanceHttpClientRequestDto } from './dto';

@Public()
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
