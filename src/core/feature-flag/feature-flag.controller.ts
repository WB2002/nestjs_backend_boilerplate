import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FeatureFlagPermission } from './constants';
import { RequirePermissions } from './decorators';
import {
  CreateFeatureFlagDto,
  DeleteFeatureFlagDto,
  UpdateFeatureFlagDto,
} from './dto';
import { FeatureFlagManager } from './feature-flag.manager';
import { FeatureFlagPermissionsGuard } from './guards';

interface AuthenticatedRequest {
  user: {
    id: string;
    email: string;
    role?: string;
  };
}

@Controller('feature-flags')
@UseGuards(FeatureFlagPermissionsGuard)
export class FeatureFlagController {
  constructor(private readonly manager: FeatureFlagManager) {}

  @Get()
  @RequirePermissions(FeatureFlagPermission.READ)
  async list(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const parsedLimit =
      limit !== undefined && limit !== '' ? Number.parseInt(limit, 10) : 50;
    return this.manager.list(
      cursor,
      Number.isFinite(parsedLimit) ? parsedLimit : 50,
    );
  }

  @Get(':key')
  @RequirePermissions(FeatureFlagPermission.READ)
  async get(@Param('key') key: string) {
    return this.manager.get(key);
  }

  @Post()
  @RequirePermissions(FeatureFlagPermission.CREATE)
  async create(
    @Body() dto: CreateFeatureFlagDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.manager.create(dto, {
      userId: req.user.id,
      email: req.user.email,
    });
  }

  @Put(':key')
  @RequirePermissions(FeatureFlagPermission.UPDATE)
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateFeatureFlagDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.manager.update(key, dto, {
      userId: req.user.id,
      email: req.user.email,
    });
  }

  @Delete(':key')
  @RequirePermissions(FeatureFlagPermission.DELETE)
  async remove(
    @Param('key') key: string,
    @Body() dto: DeleteFeatureFlagDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.manager.delete(key, dto, {
      userId: req.user.id,
      email: req.user.email,
    });
  }
}
