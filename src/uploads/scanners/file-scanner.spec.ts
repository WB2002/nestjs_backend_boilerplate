import * as net from 'node:net';
import { ClamAvFileScanner } from './clamav-file-scanner';
import { NoopFileScanner } from './noop-file-scanner';

describe('NoopFileScanner', () => {
  it('always returns clean', async () => {
    const scanner = new NoopFileScanner();
    await expect(
      scanner.scan({ buffer: Buffer.from('x'), filename: 'x.txt' }),
    ).resolves.toEqual({ status: 'clean' });
  });
});

describe('ClamAvFileScanner', () => {
  it('parses OK and FOUND responses over INSTREAM', async () => {
    const server = net.createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on('data', (c) => {
        chunks.push(c);
        const buf = Buffer.concat(chunks);
        // Wait until zero-size trailer arrives
        if (buf.includes(Buffer.from([0, 0, 0, 0]))) {
          const payload = buf.toString('utf8');
          if (payload.includes('virus')) {
            socket.end('stream: Eicar-Test-Signature FOUND\n');
          } else {
            socket.end('stream: OK\n');
          }
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP address');
    }

    const scanner = new ClamAvFileScanner({
      host: '127.0.0.1',
      port: address.port,
      timeoutMs: 5_000,
    });

    try {
      await expect(
        scanner.scan({ buffer: Buffer.from('clean'), filename: 'a.png' }),
      ).resolves.toEqual({ status: 'clean' });

      await expect(
        scanner.scan({ buffer: Buffer.from('virus'), filename: 'b.png' }),
      ).resolves.toEqual({
        status: 'infected',
        signature: 'Eicar-Test-Signature',
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it('returns error when clamd is unreachable', async () => {
    const scanner = new ClamAvFileScanner({
      host: '127.0.0.1',
      port: 1,
      timeoutMs: 500,
    });
    const result = await scanner.scan({
      buffer: Buffer.from('x'),
      filename: 'x.png',
    });
    expect(result.status).toBe('error');
  });
});
