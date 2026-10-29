import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Public } from '@/common/decorators';
import {
  CaptchaConfigurationError,
  CaptchaMalformedResponseError,
  CaptchaProviderUnavailableError,
  CaptchaService,
  CaptchaTimeoutError,
} from '@/core/captcha';
import { ExampleCaptchaRequestDto } from './dto';

/**
 * Demo-only endpoint showing how to require CAPTCHA verification.
 * Do not use this as a template for wiring captcha into auth or payments.
 */
@Public()
@Controller('example')
export class ExampleCaptchaController {
  constructor(private readonly captchaService: CaptchaService) {}

  @Post('captcha')
  @HttpCode(HttpStatus.OK)
  async verifyCaptcha(
    @Body() dto: ExampleCaptchaRequestDto,
    @Req() req: FastifyRequest,
  ): Promise<{ message: string }> {
    try {
      const verificationResult = await this.captchaService.verify(
        dto.captchaToken,
        {
          remoteIp: req.ip,
        },
      );

      if (!verificationResult.success) {
        throw new BadRequestException('Captcha verification failed');
      }

      return { message: 'Captcha verification successful' };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.mapCaptchaError(error);
    }
  }

  private mapCaptchaError(error: unknown): never {
    if (
      error instanceof CaptchaTimeoutError ||
      error instanceof CaptchaProviderUnavailableError ||
      error instanceof CaptchaMalformedResponseError
    ) {
      throw new ServiceUnavailableException('Captcha verification unavailable');
    }
    if (error instanceof CaptchaConfigurationError) {
      throw new InternalServerErrorException('Internal server error');
    }
    throw error;
  }
}
