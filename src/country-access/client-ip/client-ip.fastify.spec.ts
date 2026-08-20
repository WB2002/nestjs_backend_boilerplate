import Fastify from 'fastify';
import { parseTrustProxy } from './parse-trust-proxy';
import { ClientIpService } from './client-ip.service';

describe('ClientIpService with Fastify trustProxy', () => {
  const clientIp = new ClientIpService();

  async function withApp(
    trustProxy: boolean | string[],
    run: (inject: ReturnType<typeof Fastify>['inject']) => Promise<void>,
  ) {
    const app = Fastify({ trustProxy });
    app.get('/ip', async (request) => ({
      ip: clientIp.resolve(request),
      rawIp: request.ip,
    }));
    await app.ready();
    try {
      await run(app.inject.bind(app));
    } finally {
      await app.close();
    }
  }

  it('uses the socket address for direct clients', async () => {
    await withApp(false, async (inject) => {
      const response = await inject({
        method: 'GET',
        url: '/ip',
        remoteAddress: '203.0.113.50',
      });
      expect(response.json()).toMatchObject({ ip: '203.0.113.50' });
    });
  });

  it('ignores forwarded headers when trustProxy is false', async () => {
    await withApp(false, async (inject) => {
      const response = await inject({
        method: 'GET',
        url: '/ip',
        remoteAddress: '10.0.0.5',
        headers: {
          'x-forwarded-for': '203.0.113.9, 10.0.0.5',
        },
      });
      expect(response.json().ip).toBe('10.0.0.5');
    });
  });

  it('trusts X-Forwarded-For when trustProxy is true', async () => {
    await withApp(true, async (inject) => {
      const response = await inject({
        method: 'GET',
        url: '/ip',
        remoteAddress: '10.0.0.5',
        headers: {
          'x-forwarded-for': '203.0.113.9, 10.0.0.5',
        },
      });
      expect(response.json().ip).toBe('203.0.113.9');
    });
  });

  it('supports multi-hop forwarded chains with trusted proxies', async () => {
    const trustProxy = parseTrustProxy('10.0.0.0/8');
    await withApp(trustProxy, async (inject) => {
      const response = await inject({
        method: 'GET',
        url: '/ip',
        remoteAddress: '10.1.2.3',
        headers: {
          'x-forwarded-for': '198.51.100.20, 10.0.0.8',
        },
      });
      expect(response.json().ip).toBe('198.51.100.20');
    });
  });

  it('supports IPv6 clients', async () => {
    await withApp(false, async (inject) => {
      const response = await inject({
        method: 'GET',
        url: '/ip',
        remoteAddress: '2001:db8::abcd',
      });
      expect(response.json().ip).toBe('2001:db8::abcd');
    });
  });
});
