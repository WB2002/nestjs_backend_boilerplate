import { ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConformanceHarnessAuthGuard } from '../guards/conformance-harness-auth.guard';
import { API_PRIORITY_KEY, ApiPriorityLevel } from '@/core/overload';
import { ConformancePriorityController } from '../conformance-priority.controller';
import { withConformanceHarnessGuardStub } from './conformance-harness-guard-test.provider';

describe('ConformancePriorityController', () => {
  let testingModule: TestingModule;
  let testApplication: NestFastifyApplication;
  let controller: ConformancePriorityController;
  let reflector: Reflector;

  beforeEach(async () => {
    testingModule = await withConformanceHarnessGuardStub(
      Test.createTestingModule({
        controllers: [ConformancePriorityController],
      }),
    ).compile();

    reflector = new Reflector();
    controller = testingModule.get<ConformancePriorityController>(
      ConformancePriorityController,
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
        ConformancePriorityController,
      );
      expect(guards).toContain(ConformanceHarnessAuthGuard);
    });

    it('attaches ApiPriorityLevel.Critical metadata to critical handler', () => {
      const priorityLevel = reflector.get<ApiPriorityLevel>(
        API_PRIORITY_KEY,
        controller.critical,
      );
      expect(priorityLevel).toBe(ApiPriorityLevel.Critical);
    });

    it('attaches ApiPriorityLevel.High metadata to high handler', () => {
      const priorityLevel = reflector.get<ApiPriorityLevel>(
        API_PRIORITY_KEY,
        controller.high,
      );
      expect(priorityLevel).toBe(ApiPriorityLevel.High);
    });

    it('attaches ApiPriorityLevel.Normal metadata to normal handler', () => {
      const priorityLevel = reflector.get<ApiPriorityLevel>(
        API_PRIORITY_KEY,
        controller.normal,
      );
      expect(priorityLevel).toBe(ApiPriorityLevel.Normal);
    });

    it('attaches ApiPriorityLevel.Low metadata to low handler', () => {
      const priorityLevel = reflector.get<ApiPriorityLevel>(
        API_PRIORITY_KEY,
        controller.low,
      );
      expect(priorityLevel).toBe(ApiPriorityLevel.Low);
    });
  });

  describe('handler invocations', () => {
    it('returns { priority: "low" } for GET low?holdMs=0', async () => {
      const response = await controller.low({ holdMs: 0 });
      expect(response).toEqual({ priority: 'low' });
    });

    it('returns { priority: "normal" } for GET normal?holdMs=0', async () => {
      const response = await controller.normal({ holdMs: 0 });
      expect(response).toEqual({ priority: 'normal' });
    });

    it('returns { priority: "high" } for GET high?holdMs=0', async () => {
      const response = await controller.high({ holdMs: 0 });
      expect(response).toEqual({ priority: 'high' });
    });

    it('returns { priority: "critical" } for GET critical?holdMs=0', async () => {
      const response = await controller.critical({ holdMs: 0 });
      expect(response).toEqual({ priority: 'critical' });
    });
  });

  describe('HTTP endpoints', () => {
    it('routes GET /conformance/priority/low?holdMs=0 returning 200', async () => {
      const httpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/priority/low?holdMs=0',
      });

      expect(httpResponse.statusCode).toBe(200);
      expect(httpResponse.json()).toEqual({ priority: 'low' });
    });

    it('routes GET /conformance/priority/critical?holdMs=0 returning 200', async () => {
      const httpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/priority/critical?holdMs=0',
      });

      expect(httpResponse.statusCode).toBe(200);
      expect(httpResponse.json()).toEqual({ priority: 'critical' });
    });

    it('routes GET /conformance/priority/high?holdMs=0 returning 200', async () => {
      const httpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/priority/high?holdMs=0',
      });

      expect(httpResponse.statusCode).toBe(200);
      expect(httpResponse.json()).toEqual({ priority: 'high' });
    });

    it('routes GET /conformance/priority/normal?holdMs=0 returning 200', async () => {
      const httpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/priority/normal?holdMs=0',
      });

      expect(httpResponse.statusCode).toBe(200);
      expect(httpResponse.json()).toEqual({ priority: 'normal' });
    });

    it('defaults holdMs when omitted returning 200', async () => {
      const httpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/priority/low',
      });

      expect(httpResponse.statusCode).toBe(200);
      expect(httpResponse.json()).toEqual({ priority: 'low' });
    });

    it('returns 400 when holdMs is negative', async () => {
      const httpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/priority/low?holdMs=-1',
      });

      expect(httpResponse.statusCode).toBe(400);
    });

    it('returns 400 when holdMs exceeds 10_000', async () => {
      const httpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/priority/low?holdMs=10001',
      });

      expect(httpResponse.statusCode).toBe(400);
    });

    it('returns 400 when holdMs is not an integer', async () => {
      const httpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/priority/low?holdMs=abc',
      });

      expect(httpResponse.statusCode).toBe(400);
    });
  });
});
