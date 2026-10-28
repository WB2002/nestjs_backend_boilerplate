import {
  Controller,
  HttpCode,
  HttpStatus,
  MiddlewareConsumer,
  Module,
  NestModule,
  Post,
  RequestMethod,
} from '@nestjs/common';
import { Public } from '@/common/decorators';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import fastifyCookie from '@fastify/cookie';
import { ACCESS_TOKEN_COOKIE, CSRF_TOKEN_COOKIE } from '@/common/constants';
import { CsrfModule, CsrfMiddleware } from './index';

@Controller('probe')
class ProbeController {
  @Public()
  @Post('mutate')
  @HttpCode(HttpStatus.OK)
  mutate() {
    return { ok: true };
  }
}

@Module({
  imports: [CsrfModule.forRoot({ enabled: true })],
  controllers: [ProbeController],
})
class ProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CsrfMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}

describe('CSRF (HTTP)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();

    const adapter = new FastifyAdapter();
    await adapter.register(fastifyCookie as never, { secret: 'test-secret' });

    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 403 when session cookie present without CSRF header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/probe/mutate',
      headers: {
        cookie: `${ACCESS_TOKEN_COOKIE}=fake-jwt`,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'CSRF_VALIDATION_FAILED' });
  });

  it('returns 200 when cookie and header match', async () => {
    const token = 'test-csrf-token-value12';
    const res = await app.inject({
      method: 'POST',
      url: '/probe/mutate',
      headers: {
        'x-csrf-token': token,
        cookie: `${ACCESS_TOKEN_COOKIE}=fake-jwt; ${CSRF_TOKEN_COOKIE}=${token}`,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
