import { Injectable } from '@nestjs/common';
import type { FileScanResult, FileScanner } from './file-scanner';

@Injectable()
export class NoopFileScanner implements FileScanner {
  readonly isScanningEnabled = false;

  async scan(_input: {
    buffer?: Buffer;
    tempPath?: string;
    filename: string;
  }): Promise<FileScanResult> {
    return { status: 'clean' };
  }
}
