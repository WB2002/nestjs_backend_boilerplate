import { Controller, Get } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import compress from '@fastify/compress';
import { brotliDecompressSync, gunzipSync } from 'zlib';

const COMPRESSION_THRESHOLD = 1024;
const LARGE_PAYLOAD = 'x'.repeat(COMPRESSION_THRESHOLD + 64);
const SMALL_PAYLOAD = 'ok';

@Controller()
class CompressionProbeController {
  @Get('large')
  large(): string {
    return LARGE_PAYLOAD;
  }

  @Get('small')
  small(): string {
    return SMALL_PAYLOAD;
  }
}

/**
 * Wire-level coverage for @fastify/compress registration used in main.ts:
 * encoding negotiation, size threshold, and identity / no Accept-Encoding.
 */
describe('response compression (HTTP)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CompressionProbeController],
    }).compile();

    const adapter = new FastifyAdapter();
    await adapter.register(compress as any, {
      global: true,
      encodings: ['br', 'gzip'],
      threshold: COMPRESSION_THRESHOLD,
    });

    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('compresses large payloads with gzip when Accept-Encoding includes gzip', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/large',
      headers: { 'accept-encoding': 'gzip' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(res.rawPayload).toString('utf8')).toBe(LARGE_PAYLOAD);
  });

  it('compresses large payloads with brotli when Accept-Encoding prefers br', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/large',
      headers: { 'accept-encoding': 'br' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(brotliDecompressSync(res.rawPayload).toString('utf8')).toBe(
      LARGE_PAYLOAD,
    );
  });

  it('does not compress payloads below the threshold', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/small',
      headers: { 'accept-encoding': 'gzip, br' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toBe(SMALL_PAYLOAD);
  });

  it('leaves the body uncompressed for Accept-Encoding: identity', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/large',
      headers: { 'accept-encoding': 'identity' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toBe(LARGE_PAYLOAD);
  });

  it('leaves the body uncompressed when Accept-Encoding is omitted', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/large',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toBe(LARGE_PAYLOAD);
  });
});
