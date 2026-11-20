import { Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConformanceHarnessAuthGuard } from '../guards/conformance-harness-auth.guard';
import { REDACTED } from '@/core/redaction';
import { ConformanceRedactionController } from '../conformance-redaction.controller';
import { withConformanceHarnessGuardStub } from './conformance-harness-guard-test.provider';
import { ConformanceRedactionRequestDto } from '../dto';

describe('ConformanceRedactionController', () => {
  let testingModule: TestingModule;
  let testApplication: NestFastifyApplication;
  let controller: ConformanceRedactionController;
  let reflector: Reflector;

  beforeEach(async () => {
    testingModule = await withConformanceHarnessGuardStub(
      Test.createTestingModule({
        controllers: [ConformanceRedactionController],
      }),
    ).compile();

    reflector = new Reflector();
    controller = testingModule.get<ConformanceRedactionController>(
      ConformanceRedactionController,
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
    it('protects the controller with ConformanceHarnessAuthGuard', () => {
      const guards = reflector.get<unknown[] | undefined>(
        GUARDS_METADATA,
        ConformanceRedactionController,
      );
      expect(guards).toContain(ConformanceHarnessAuthGuard);
    });
  });

  describe('handler invocations', () => {
    it('redacts sensitive fields and logs payload through Nest Logger', () => {
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);

      const requestPayload = {
        email: 'a@b.co',
        password: 'hunter2',
        profile: {
          name: 'Ann',
          accessToken: 'tok',
        },
        note: 'card 4111 1111 1111 1111',
      };

      const requestDto: ConformanceRedactionRequestDto = {
        payload: requestPayload,
      };

      const redactionResponse = controller.redact(requestDto);

      expect(loggerSpy).toHaveBeenCalledWith({
        conformancePayload: requestPayload,
      });

      // Redacted payload assertions
      expect(redactionResponse.redactedPayload['password']).toBe(REDACTED);

      const profilePayload = redactionResponse.redactedPayload[
        'profile'
      ] as Record<string, unknown>;
      expect(profilePayload['accessToken']).toBe(REDACTED);
      expect(profilePayload['name']).toBe('Ann');
      expect(redactionResponse.redactedPayload['email']).toBe(REDACTED);
      // Current redact-value-patterns does not mask credit cards in non-sensitive keys
      expect(redactionResponse.redactedPayload['note']).toBe(
        'card 4111 1111 1111 1111',
      );

      // Redacted span attributes assertions
      expect(
        redactionResponse.redactedSpanAttributes['profile.accessToken'],
      ).toBe(REDACTED);
      expect(redactionResponse.redactedSpanAttributes['password']).toBe(
        REDACTED,
      );
      expect(redactionResponse.redactedSpanAttributes['email']).toBe(REDACTED);
      expect(redactionResponse.redactedSpanAttributes['profile.name']).toBe(
        'Ann',
      );
      expect(redactionResponse.redactedSpanAttributes['note']).toBe(
        'card 4111 1111 1111 1111',
      );

      loggerSpy.mockRestore();
    });

    it('flattens nested objects up to max depth 4 and ignores non-primitives', () => {
      const nestedPayload = {
        level1: {
          level2: {
            level3: {
              level4Primitive: 'deep-value',
              level4Obj: {
                level5Primitive: 'too-deep',
              },
            },
          },
        },
        arrayValue: ['should', 'be', 'ignored'],
        nullValue: null,
      };

      const redactionResponse = controller.redact({ payload: nestedPayload });

      expect(
        redactionResponse.redactedSpanAttributes[
          'level1.level2.level3.level4Primitive'
        ],
      ).toBe('deep-value');
      expect(
        redactionResponse.redactedSpanAttributes[
          'level1.level2.level3.level4Obj.level5Primitive'
        ],
      ).toBeUndefined();
      expect(
        redactionResponse.redactedSpanAttributes['arrayValue'],
      ).toBeUndefined();
      expect(
        redactionResponse.redactedSpanAttributes['nullValue'],
      ).toBeUndefined();
    });
  });

  describe('HTTP endpoints', () => {
    it('routes POST /conformance/redaction returning 200 with redaction response', async () => {
      const requestPayload = {
        email: 'a@b.co',
        password: 'hunter2',
        profile: {
          name: 'Ann',
          accessToken: 'tok',
        },
        note: 'card 4111 1111 1111 1111',
      };

      const httpResponse = await testApplication.inject({
        method: 'POST',
        url: '/conformance/redaction',
        payload: {
          payload: requestPayload,
        },
      });

      expect(httpResponse.statusCode).toBe(200);
      const jsonResponse = httpResponse.json();
      expect(jsonResponse.redactedPayload.password).toBe(REDACTED);
      expect(jsonResponse.redactedPayload.profile.accessToken).toBe(REDACTED);
      expect(jsonResponse.redactedPayload.profile.name).toBe('Ann');
      expect(jsonResponse.redactedPayload.email).toBe(REDACTED);
      expect(jsonResponse.redactedPayload.note).toBe(
        'card 4111 1111 1111 1111',
      );
      expect(jsonResponse.redactedSpanAttributes['profile.accessToken']).toBe(
        REDACTED,
      );
      expect(jsonResponse.redactedSpanAttributes.password).toBe(REDACTED);
      expect(jsonResponse.redactedSpanAttributes.email).toBe(REDACTED);
      expect(jsonResponse.redactedSpanAttributes['profile.name']).toBe('Ann');
      expect(jsonResponse.redactedSpanAttributes.note).toBe(
        'card 4111 1111 1111 1111',
      );
    });
  });
});
