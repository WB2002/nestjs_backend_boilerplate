import {
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { validate } from 'class-validator';
import {
  CaptchaProviderUnavailableError,
  CaptchaService,
} from '@/core/captcha';
import { ExampleCaptchaRequestDto } from '../dto';
import { ExampleCaptchaController } from '../example-captcha.controller';

describe('ExampleCaptchaController', () => {
  let controller: ExampleCaptchaController;
  let verify: jest.Mock;

  beforeEach(() => {
    verify = jest.fn();
    const captchaService = { verify } as unknown as CaptchaService;
    controller = new ExampleCaptchaController(captchaService);
  });

  function req(ip = '127.0.0.1'): FastifyRequest {
    return { ip } as FastifyRequest;
  }

  it('rejects missing captchaToken via DTO validation', async () => {
    const dto = new ExampleCaptchaRequestDto();
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'captchaToken')).toBe(true);
  });

  it('rejects empty captchaToken via ValidationPipe whitelist rules', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    await expect(
      pipe.transform({}, { type: 'body', metatype: ExampleCaptchaRequestDto }),
    ).rejects.toBeDefined();
  });

  it('returns 400 when captcha verification fails', async () => {
    verify.mockResolvedValue({
      success: false,
      errorCodes: ['invalid-input-response'],
    });

    await expect(
      controller.verifyCaptcha({ captchaToken: 'bad' }, req()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(verify).toHaveBeenCalledWith('bad', { remoteIp: '127.0.0.1' });
  });

  it('returns success when captcha verification succeeds', async () => {
    verify.mockResolvedValue({ success: true });

    await expect(
      controller.verifyCaptcha({ captchaToken: 'good' }, req('1.2.3.4')),
    ).resolves.toEqual({ message: 'Captcha verification successful' });
    expect(verify).toHaveBeenCalledWith('good', { remoteIp: '1.2.3.4' });
  });

  it('returns 503 when the captcha provider fails', async () => {
    verify.mockRejectedValue(new CaptchaProviderUnavailableError());

    await expect(
      controller.verifyCaptcha({ captchaToken: 'token' }, req()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('returns 500 when captcha configuration is missing', async () => {
    const { CaptchaConfigurationError } = await import('@/core/captcha');
    verify.mockRejectedValue(new CaptchaConfigurationError());

    await expect(
      controller.verifyCaptcha({ captchaToken: 'token' }, req()),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
