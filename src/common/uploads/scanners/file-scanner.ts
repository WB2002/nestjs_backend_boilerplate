export type FileScanResult =
  | { status: 'clean' }
  | { status: 'infected'; signature?: string }
  | { status: 'error'; message: string };

export interface FileScanner {
  /** Whether this scanner actually inspects content (false for Noop). */
  readonly isScanningEnabled: boolean;
  scan(input: {
    buffer?: Buffer;
    tempPath?: string;
    filename: string;
  }): Promise<FileScanResult>;
}

export const FILE_SCANNER = Symbol('FILE_SCANNER');
