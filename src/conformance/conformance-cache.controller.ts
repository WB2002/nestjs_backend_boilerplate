import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConformanceHarnessAuthGuard } from './guards/conformance-harness-auth.guard';
import { ConformanceCacheRequestDto } from './dto';
import {
  ConformanceCacheResponse,
  ConformanceCacheService,
} from './conformance-cache.service';

export interface ConformanceCacheDeleteResponse {
  deleted: boolean;
}

@UseGuards(ConformanceHarnessAuthGuard)
@Controller('conformance/cache')
export class ConformanceCacheController {
  constructor(
    private readonly conformanceCacheService: ConformanceCacheService,
  ) {}

  @Post()
  @HttpCode(200)
  post(
    @Body() request: ConformanceCacheRequestDto,
  ): Promise<ConformanceCacheResponse> {
    return this.conformanceCacheService.getOrSet(request);
  }

  @Delete(':key')
  async delete(
    @Param('key') key: string,
  ): Promise<ConformanceCacheDeleteResponse> {
    await this.conformanceCacheService.reset(key);
    return { deleted: true };
  }
}
