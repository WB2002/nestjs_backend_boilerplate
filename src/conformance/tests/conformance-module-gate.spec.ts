import { Controller, Get, Module } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { isConformanceHarnessEnabled } from '@/common/config/is-conformance-harness-enabled';
import { ConformanceModule } from '@/conformance';

@Controller('conformance')
class ConformanceProbeTestController {
  @Get('cache-probe')
  getCacheProbe() {
    return { isProbeReady: true };
  }
}

@Module({
  controllers: [ConformanceProbeTestController],
})
class ConformanceProbeTestModule {}

async function createHarnessTestApp(
  environmentConfig: NodeJS.ProcessEnv,
): Promise<NestFastifyApplication> {
  const isEnabled = isConformanceHarnessEnabled(environmentConfig);
  const moduleRef = await Test.createTestingModule({
    imports: [...(isEnabled ? [ConformanceModule] : [])],
  })
    .overrideModule(ConformanceModule)
    .useModule(ConformanceProbeTestModule)
    .compile();

  const fastifyAdapter = new FastifyAdapter();
  const testApplication =
    moduleRef.createNestApplication<NestFastifyApplication>(fastifyAdapter);
  await testApplication.init();
  await testApplication.getHttpAdapter().getInstance().ready();
  return testApplication;
}

describe('ConformanceModule gate', () => {
  it('returns 404 for /conformance/cache-probe when CONFORMANCE_HARNESS_ENABLED is unset', async () => {
    const testApplication = await createHarnessTestApp({});
    try {
      const httpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/cache-probe',
      });
      expect(httpResponse.statusCode).toBe(404);
    } finally {
      await testApplication.close();
    }
  });

  it('routes /conformance/cache-probe when CONFORMANCE_HARNESS_ENABLED is true', async () => {
    const testApplication = await createHarnessTestApp({
      CONFORMANCE_HARNESS_ENABLED: 'true',
    });
    try {
      const httpResponse = await testApplication.inject({
        method: 'GET',
        url: '/conformance/cache-probe',
      });
      expect(httpResponse.statusCode).toBe(200);
      expect(httpResponse.json()).toEqual({ isProbeReady: true });
    } finally {
      await testApplication.close();
    }
  });
});
