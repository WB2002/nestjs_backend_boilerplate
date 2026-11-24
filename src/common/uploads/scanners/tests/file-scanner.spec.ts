import * as net from 'node:net';
import { ClamAvFileScanner } from '../clamav-file-scanner';
import { NoopFileScanner } from '../noop-file-scanner';

describe('NoopFileScanner', () => {
  it('always returns clean', async () => {
    const scanner = new NoopFileScanner();
    await expect(
      scanner.scan({ buffer: Buffer.from('x'), filename: 'x.txt' }),
    ).resolves.toEqual({ status: 'clean' });
  });
});

describe('ClamAvFileScanner', () => {
  it('parses OK and FOUND responses without waiting for socket end', async () => {
    const activeSockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      activeSockets.add(socket);
      socket.on('close', () => {
        activeSockets.delete(socket);
      });
      socket.on('error', () => {
        // Client destroys the socket as soon as a complete status line arrives;
        // ignore peer resets such as ECONNRESET on the mock server side.
        socket.destroy();
      });

      const chunks: Buffer[] = [];
      let hasReplied = false;
      socket.on('data', (chunk) => {
        if (hasReplied) {
          return;
        }
        chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        const header = Buffer.from('zINSTREAM\0');
        if (buf.length < header.length) {
          return;
        }

        // Parse INSTREAM length-prefixed frames until the 4-byte zero trailer.
        let offset = header.length;
        const payloadParts: Buffer[] = [];
        while (offset + 4 <= buf.length) {
          const frameLength = buf.readUInt32BE(offset);
          offset += 4;
          if (frameLength === 0) {
            hasReplied = true;
            const payload = Buffer.concat(payloadParts).toString('utf8');
            // Mimic real clamd: write reply and keep the connection open.
            if (payload.includes('virus')) {
              socket.write('stream: Eicar-Test-Signature FOUND\n');
            } else {
              socket.write('stream: OK\n');
            }
            return;
          }
          if (offset + frameLength > buf.length) {
            return;
          }
          payloadParts.push(buf.subarray(offset, offset + frameLength));
          offset += frameLength;
        }
      });
    });

    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
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
      for (const socket of activeSockets) {
        socket.destroy();
      }
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
    const outcome = await scanner.scan({
      buffer: Buffer.from('x'),
      filename: 'x.png',
    });
    expect(outcome.status).toBe('error');
  });
});
