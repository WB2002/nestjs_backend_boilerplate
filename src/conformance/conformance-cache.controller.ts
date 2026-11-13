import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { Public } from '@/common/decorators';
import { ConformanceCacheRequestDto } from './dto';
import {
  ConformanceCacheResponse,
  ConformanceCacheService,
} from './conformance-cache.service';

export interface ConformanceCacheDeleteResponse {
  deleted: boolean;
}

@Public()
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
