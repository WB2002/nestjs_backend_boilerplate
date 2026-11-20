import { ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConformanceHarnessAuthGuard } from '../guards/conformance-harness-auth.guard';
import { RequestDeadlineExceededError } from '@/core/request-deadline';
import { DeadlineContext } from '@/core/request-deadline/context/deadline.context';
import {
  RequestDeadlineInternals,
  RequestDeadlineStore,
} from '@/core/request-deadline/types/request-deadline.types';
import { ConformanceDeadlineController } from '../conformance-deadline.controller';
import { withConformanceHarnessGuardStub } from './conformance-harness-guard-test.provider';

const noopInternals: RequestDeadlineInternals = {
  clearTimer: () => undefined,
  rescheduleFromStart: () => undefined,
  setReason: () => undefined,
  abort: () => undefined,
};

describe('ConformanceDeadlineController', () => {
  let testingModule: TestingModule;
  let testApplication: NestFastifyApplication;
  let controller: ConformanceDeadlineController;
  let reflector: Reflector;

  beforeEach(async () => {
    testingModule = await withConformanceHarnessGuardStub(
      Test.createTestingModule({
        controllers: [ConformanceDeadlineController],
      }),
    ).compile();

    reflector = new Reflector();
    controller = testingModule.get<ConformanceDeadlineController>(
      ConformanceDeadlineController,
    );

    testApplication =
      testingModule.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
    testApplication.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        transformOptions: { enableImplicitConversion: true },
      }),
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
        ConformanceDeadlineController,
      );
      expect(guards).toContain(ConformanceHarnessAuthGuard);
    });
  });

  describe('slow handler', () => {
    it('returns completedAfterMs and remainingBudgetMs null outside deadline context', async () => {
      const response = await controller.slow({ delayMs: 0 });
      expect(response.completedAfterMs).toBeGreaterThanOrEqual(0);
      expect(response.remainingBudgetMs).toBeNull();
    });

    it('returns remainingBudgetMs from deadline context when present', async () => {
      const abortController = new AbortController();
      const store: RequestDeadlineStore = {
        signal: abortController.signal,
        startedAt: Date.now(),
        deadlineAt: Date.now() + 5_000,
      };

      await DeadlineContext.run(store, noopInternals, async () => {
        const response = await controller.slow({ delayMs: 0 });
        expect(response.completedAfterMs).toBeGreaterThanOrEqual(0);
        expect(typeof response.remainingBudgetMs).toBe('number');
        expect(response.remainingBudgetMs).toBeGreaterThan(0);
      });
    });

    it('throws RequestDeadlineExceededError when deadline signal is aborted', async () => {
      const abortController = new AbortController();
      abortController.abort('timeout');

      const store: RequestDeadlineStore = {
        signal: abortController.signal,
        startedAt: Date.now() - 5_000,
        deadlineAt: Date.now() - 1,
        reason: 'timeout',
      };

      await DeadlineContext.run(store, noopInternals, async () => {
        await expect(controller.slow({ delayMs: 100 })).rejects.toThrow(
          RequestDeadlineExceededError,
        );
      });
    });
  });

  describe('HTTP endpoints', () => {
    it('routes GET /conformance/deadline/slow?delayMs=0 returning 200', async () => {
      const httpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/deadline/slow?delayMs=0',
      });

      expect(httpResponse.statusCode).toBe(200);
      const body = httpResponse.json();
      expect(body.completedAfterMs).toBeGreaterThanOrEqual(0);
      expect(body.remainingBudgetMs).toBeNull();
    });

    it('defaults delayMs when omitted returning 200', async () => {
      const httpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/deadline/slow',
      });

      expect(httpResponse.statusCode).toBe(200);
      const body = httpResponse.json();
      expect(body.completedAfterMs).toBeGreaterThanOrEqual(0);
      expect(body.remainingBudgetMs).toBeNull();
    });

    it('returns 400 when delayMs is negative', async () => {
      const httpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/deadline/slow?delayMs=-1',
      });

      expect(httpResponse.statusCode).toBe(400);
    });

    it('returns 400 when delayMs exceeds 30_000', async () => {
      const httpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/deadline/slow?delayMs=30001',
      });

      expect(httpResponse.statusCode).toBe(400);
    });

    it('returns 400 when delayMs is not an integer', async () => {
      const httpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/deadline/slow?delayMs=invalid',
      });

      expect(httpResponse.statusCode).toBe(400);
    });
  });
});
