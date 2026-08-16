import { ServiceUnavailableException } from '@nestjs/common';
import {
  UploadValidationError,
  validateUploadFiles,
} from './validate-upload-files';
import { NoopFileScanner } from './scanners/noop-file-scanner';
import type { FileScanner } from './scanners/file-scanner';
import { DEFAULT_UPLOAD_OPTIONS, IncomingUploadFile } from './upload.types';
import { UPLOAD_REJECT_CODES } from './upload.types';

/** Minimal valid 1x1 PNG */
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function pngFile(name = 'a.png'): IncomingUploadFile {
  return {
    fieldname: 'files',
    originalname: name,
    mimetype: 'image/png',
    buffer: PNG_BUFFER,
    size: PNG_BUFFER.length,
  };
}

describe('validateUploadFiles', () => {
  const scanner = new NoopFileScanner();

  it('accepts multiple valid files under the limit', async () => {
    const result = await validateUploadFiles(
      [pngFile('one.png'), pngFile('two.png')],
      { ...DEFAULT_UPLOAD_OPTIONS, maxFiles: 5 },
      scanner,
    );
    expect(result).toHaveLength(2);
    expect(result[0]?.storedName).toMatch(/\.png$/);
    expect(result[0]?.scanned).toBe(false);
  });

  it('rejects when maxFiles is exceeded', async () => {
    await expect(
      validateUploadFiles(
        [pngFile('a.png'), pngFile('b.png'), pngFile('c.png')],
        { ...DEFAULT_UPLOAD_OPTIONS, maxFiles: 2 },
        scanner,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: UPLOAD_REJECT_CODES.MAX_FILES_EXCEEDED,
      }),
    });
  });

  it('rejects MIME / magic mismatch', async () => {
    await expect(
      validateUploadFiles(
        [
          {
            ...pngFile('evil.pdf'),
            originalname: 'evil.pdf',
            mimetype: 'application/pdf',
          },
        ],
        DEFAULT_UPLOAD_OPTIONS,
        scanner,
      ),
    ).rejects.toBeInstanceOf(UploadValidationError);
  });

  it('rejects infected files from scanner', async () => {
    const infected: FileScanner = {
      performsScan: true,
      scan: async () => ({ status: 'infected', signature: 'Eicar-Test' }),
    };
    await expect(
      validateUploadFiles([pngFile()], DEFAULT_UPLOAD_OPTIONS, infected),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: UPLOAD_REJECT_CODES.MALWARE_DETECTED,
      }),
    });
  });

  it('returns 503 when scanner errors (fail closed)', async () => {
    const broken: FileScanner = {
      performsScan: true,
      scan: async () => ({ status: 'error', message: 'down' }),
    };
    await expect(
      validateUploadFiles([pngFile()], DEFAULT_UPLOAD_OPTIONS, broken),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('sets scanned true when scanner.performsScan is true', async () => {
    const real: FileScanner = {
      performsScan: true,
      scan: async () => ({ status: 'clean' }),
    };
    const result = await validateUploadFiles(
      [pngFile()],
      DEFAULT_UPLOAD_OPTIONS,
      real,
    );
    expect(result[0]?.scanned).toBe(true);
  });
});
