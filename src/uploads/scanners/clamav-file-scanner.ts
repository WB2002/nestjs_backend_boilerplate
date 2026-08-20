import { Injectable } from '@nestjs/common';
import * as net from 'node:net';
import type { FileScanResult, FileScanner } from './file-scanner';

export type ClamAvFileScannerOptions = {
  host: string;
  port: number;
  timeoutMs?: number;
  chunkSize?: number;
};

const DEFAULT_CHUNK_SIZE = 64 * 1024;

/**
 * ClamAV daemon scanner via the INSTREAM TCP protocol.
 * @see https://linux.die.net/man/8/clamd
 */
@Injectable()
export class ClamAvFileScanner implements FileScanner {
  readonly performsScan = true;

  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly chunkSize: number;

  constructor(options: ClamAvFileScannerOptions) {
    this.host = options.host;
    this.port = options.port;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  }

  async scan(input: {
    buffer: Buffer;
    filename: string;
  }): Promise<FileScanResult> {
    try {
      const response = await this.instream(input.buffer);
      const normalized = response.replace(/\0/g, '').trim();

      if (/^stream:\s*OK$/im.test(normalized) || /\bstream:\s*OK\b/i.test(normalized)) {
        return { status: 'clean' };
      }
      const infectedMatch = /stream:\s*(.+?)\s+FOUND/i.exec(normalized);
      if (infectedMatch?.[1]) {
        return { status: 'infected', signature: infectedMatch[1].trim() };
      }
      if (/\bFOUND\b/i.test(normalized)) {
        return { status: 'infected', signature: normalized };
      }
      if (/\bERROR\b/i.test(normalized)) {
        return { status: 'error', message: normalized };
      }
      return {
        status: 'error',
        message: `Unexpected ClamAV response: ${normalized}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'error', message };
    }
  }

  private instream(buffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      let settled = false;

      const finish = (err: Error | null, response?: string) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        if (err) {
          reject(err);
          return;
        }
        resolve(response ?? '');
      };

      socket.setTimeout(this.timeoutMs, () => {
        finish(new Error('ClamAV scan timed out'));
      });
      socket.on('error', (err) => finish(err));
      socket.on('data', (chunk) => {
        chunks.push(chunk);
        const text = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '');
        // Real clamd often replies and keeps the connection open — resolve
        // on the first complete status line instead of waiting for 'end'.
        if (
          /stream:\s*OK/i.test(text) ||
          /stream:\s*.+\s+FOUND/i.test(text) ||
          /ERROR/i.test(text)
        ) {
          finish(null, text.trim());
        }
      });
      socket.on('end', () => {
        finish(null, Buffer.concat(chunks).toString('utf8').trim());
      });

      socket.on('connect', () => {
        socket.write(Buffer.from('zINSTREAM\0'));
        let offset = 0;
        const writeNext = () => {
          if (settled) {
            return;
          }
          if (offset >= buffer.length) {
            const zero = Buffer.alloc(4);
            zero.writeUInt32BE(0, 0);
            socket.write(zero);
            return;
          }
          const end = Math.min(offset + this.chunkSize, buffer.length);
          const slice = buffer.subarray(offset, end);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(slice.length, 0);
          const ok = socket.write(Buffer.concat([size, slice]));
          offset = end;
          if (!ok) {
            socket.once('drain', writeNext);
          } else {
            writeNext();
          }
        };
        writeNext();
      });
    });
  }
}
