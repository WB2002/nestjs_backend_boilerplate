import { Injectable } from '@nestjs/common';
import type { FileScanResult, FileScanner } from './file-scanner';

@Injectable()
export class NoopFileScanner implements FileScanner {
  readonly performsScan = false;

  async scan(_input: {
    buffer: Buffer;
    filename: string;
  }): Promise<FileScanResult> {
    return { status: 'clean' };
  }
}
