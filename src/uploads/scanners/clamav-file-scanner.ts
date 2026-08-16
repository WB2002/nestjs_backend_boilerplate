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
      if (response.endsWith('OK') || response.includes(' OK')) {
        return { status: 'clean' };
      }
      const infectedMatch = /stream: (.+) FOUND/i.exec(response);
      if (infectedMatch?.[1]) {
        return { status: 'infected', signature: infectedMatch[1].trim() };
      }
      if (/FOUND/i.test(response)) {
        return { status: 'infected', signature: response.trim() };
      }
      return {
        status: 'error',
        message: `Unexpected ClamAV response: ${response}`,
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

      const onError = (err: Error) => {
        socket.destroy();
        reject(err);
      };

      socket.setTimeout(this.timeoutMs, () => {
        onError(new Error('ClamAV scan timed out'));
      });
      socket.on('error', onError);
      socket.on('data', (chunk) => chunks.push(chunk));
      socket.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8').trim());
      });

      socket.on('connect', () => {
        socket.write(Buffer.from('zINSTREAM\0'));
        let offset = 0;
        const writeNext = () => {
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
