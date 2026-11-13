import { Reflector } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '@/common/constants';
import {
  RATE_LIMIT_KEY,
  RateLimitAlgorithm,
  RateLimitDecoratorOptions,
  RateLimitIdentifier,
} from '@/core/rate-limiter';
import { ConformanceRateLimitController } from '../conformance-rate-limit.controller';

describe('ConformanceRateLimitController', () => {
  let testingModule: TestingModule;
  let testApplication: NestFastifyApplication;
  let controller: ConformanceRateLimitController;
  let reflector: Reflector;

  beforeEach(async () => {
    testingModule = await Test.createTestingModule({
      controllers: [ConformanceRateLimitController],
    }).compile();

    reflector = new Reflector();
    controller = testingModule.get<ConformanceRateLimitController>(
      ConformanceRateLimitController,
    );

    testApplication =
      testingModule.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
    await testApplication.init();
    await testApplication.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await testApplication.close();
  });

  describe('metadata', () => {
    it('does not decorate the controller class with @Public() so user route remains JWT-protected', () => {
      const isControllerPublic = reflector.get<boolean | undefined>(
        IS_PUBLIC_KEY,
        ConformanceRateLimitController,
      );
      expect(isControllerPublic).toBeUndefined();
    });

    it('attaches rate-limit metadata with UserId to user handler and leaves it without @Public()', () => {
      const isUserPublic = reflector.get<boolean | undefined>(
        IS_PUBLIC_KEY,
        controller.user,
      );
      expect(isUserPublic).toBeUndefined();

      const userRateLimitOptions = reflector.get<
        RateLimitDecoratorOptions | undefined
      >(RATE_LIMIT_KEY, controller.user);
      expect(userRateLimitOptions).toBeDefined();
      expect(userRateLimitOptions?.algorithm).toBe(
        RateLimitAlgorithm.FixedWindowCounter,
      );
      expect(userRateLimitOptions?.methods).toEqual([
        {
          name: 'conformance-user',
          identifier: RateLimitIdentifier.UserId,
          duration: 60_000,
          limit: 3,
        },
      ]);
    });

    it('attaches rate-limit metadata with DeviceFingerprint to fingerprint handler and decorates with @Public()', () => {
      const isFingerprintPublic = reflector.get<boolean | undefined>(
        IS_PUBLIC_KEY,
        controller.fingerprint,
      );
      expect(isFingerprintPublic).toBe(true);

      const fingerprintRateLimitOptions = reflector.get<
        RateLimitDecoratorOptions | undefined
      >(RATE_LIMIT_KEY, controller.fingerprint);
      expect(fingerprintRateLimitOptions).toBeDefined();
      expect(fingerprintRateLimitOptions?.algorithm).toBe(
        RateLimitAlgorithm.FixedWindowCounter,
      );
      expect(fingerprintRateLimitOptions?.methods).toEqual([
        {
          name: 'conformance-fingerprint',
          identifier: RateLimitIdentifier.DeviceFingerprint,
          duration: 60_000,
          limit: 3,
        },
      ]);
    });

    it('attaches rate-limit metadata with GuestId to guest handler and decorates with @Public()', () => {
      const isGuestPublic = reflector.get<boolean | undefined>(
        IS_PUBLIC_KEY,
        controller.guest,
      );
      expect(isGuestPublic).toBe(true);

      const guestRateLimitOptions = reflector.get<
        RateLimitDecoratorOptions | undefined
      >(RATE_LIMIT_KEY, controller.guest);
      expect(guestRateLimitOptions).toBeDefined();
      expect(guestRateLimitOptions?.algorithm).toBe(
        RateLimitAlgorithm.FixedWindowCounter,
      );
      expect(guestRateLimitOptions?.methods).toEqual([
        {
          name: 'conformance-guest',
          identifier: RateLimitIdentifier.GuestId,
          duration: 60_000,
          limit: 3,
        },
      ]);
    });
  });

  describe('handler invocations', () => {
    it('returns { identifierKind: "user" } from user handler', () => {
      const userResponse = controller.user();
      expect(userResponse).toEqual({ identifierKind: 'user' });
    });

    it('returns { identifierKind: "fingerprint" } from fingerprint handler', () => {
      const fingerprintResponse = controller.fingerprint();
      expect(fingerprintResponse).toEqual({ identifierKind: 'fingerprint' });
    });

    it('returns { identifierKind: "guest" } from guest handler', () => {
      const guestResponse = controller.guest();
      expect(guestResponse).toEqual({ identifierKind: 'guest' });
    });
  });

  describe('HTTP endpoints', () => {
    it('routes GET /conformance/rate-limit/user returning 200 with { identifierKind: "user" }', async () => {
      const userHttpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/rate-limit/user',
      });
      expect(userHttpResponse.statusCode).toBe(200);
      expect(userHttpResponse.json()).toEqual({ identifierKind: 'user' });
    });

    it('routes GET /conformance/rate-limit/fingerprint returning 200 with { identifierKind: "fingerprint" }', async () => {
      const fingerprintHttpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/rate-limit/fingerprint',
      });
      expect(fingerprintHttpResponse.statusCode).toBe(200);
      expect(fingerprintHttpResponse.json()).toEqual({
        identifierKind: 'fingerprint',
      });
    });

    it('routes GET /conformance/rate-limit/guest returning 200 with { identifierKind: "guest" }', async () => {
      const guestHttpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/rate-limit/guest',
      });
      expect(guestHttpResponse.statusCode).toBe(200);
      expect(guestHttpResponse.json()).toEqual({ identifierKind: 'guest' });
    });
  });
});
