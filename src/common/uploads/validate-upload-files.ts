import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FileScanner } from './scanners/file-scanner';
import { detectMimeFromMagicBytes } from './detect-mime-from-magic';
import { readUploadPrefix, removeTempUpload } from './read-file-bytes';
import { UploadScanSemaphore } from './upload-scan-semaphore';
import {
  AcceptedUploadFile,
  IncomingUploadFile,
  UPLOAD_REJECT_CODES,
  UploadValidationOptions,
} from './upload.types';

export class UploadValidationError extends BadRequestException {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super({ statusCode: 400, code, message });
  }
}

/**
 * Validate multiple uploaded files: count → size → extension → MIME → magic bytes → virus scan.
 */
const uploadScanSemaphore = new UploadScanSemaphore();

export async function validateUploadFiles(
  files: IncomingUploadFile[],
  options: UploadValidationOptions,
  scanner: FileScanner,
): Promise<AcceptedUploadFile[]> {
  if (files.length === 0) {
    throw new UploadValidationError(
      UPLOAD_REJECT_CODES.EMPTY_FILE,
      'At least one file is required',
    );
  }

  if (files.length > options.maxFiles) {
    throw new UploadValidationError(
      UPLOAD_REJECT_CODES.MAX_FILES_EXCEEDED,
      `At most ${options.maxFiles} files are allowed`,
    );
  }

  let totalSize = 0;
  const accepted: AcceptedUploadFile[] = [];

  for (const file of files) {
    try {
      const payloadLength = file.size;
      if (payloadLength === 0) {
        throw new UploadValidationError(
          UPLOAD_REJECT_CODES.EMPTY_FILE,
          'Empty files are not allowed',
        );
      }

      if (file.size > options.maxFileSize) {
        throw new UploadValidationError(
          UPLOAD_REJECT_CODES.FILE_TOO_LARGE,
          `Each file must be at most ${options.maxFileSize} bytes`,
        );
      }

      totalSize += file.size;
      if (totalSize > options.maxTotalSize) {
        throw new UploadValidationError(
          UPLOAD_REJECT_CODES.TOTAL_SIZE_EXCEEDED,
          `Total upload size must be at most ${options.maxTotalSize} bytes`,
        );
      }

      const originalName = sanitizeOriginalName(file.originalname);
      const extension = extname(originalName).toLowerCase();
      if (!options.allowedExtensions.includes(extension)) {
        throw new UploadValidationError(
          UPLOAD_REJECT_CODES.INVALID_FILE_TYPE,
          'File extension is not allowed',
        );
      }

      const declaredMime = (file.mimetype || '').toLowerCase();
      if (!options.allowedMimeTypes.includes(declaredMime)) {
        throw new UploadValidationError(
          UPLOAD_REJECT_CODES.INVALID_FILE_TYPE,
          'File MIME type is not allowed',
        );
      }

      const magicPrefix = await readUploadPrefix(file, 512);
      const detected = detectMimeFromMagicBytes(magicPrefix);
      if (
        !detected ||
        !options.allowedMimeTypes.includes(detected.mime) ||
        !mimeMatchesExtension(detected.mime, extension)
      ) {
        throw new UploadValidationError(
          UPLOAD_REJECT_CODES.INVALID_FILE_TYPE,
          'File content does not match an allowed type',
        );
      }

      const scan = await uploadScanSemaphore.run(() =>
        scanner.scan({
          ...(file.buffer ? { buffer: file.buffer } : {}),
          ...(file.tempPath ? { tempPath: file.tempPath } : {}),
          filename: originalName,
        }),
      );
      if (scan.status === 'infected') {
        throw new UploadValidationError(
          UPLOAD_REJECT_CODES.MALWARE_DETECTED,
          'Malicious file rejected',
        );
      }
      if (scan.status === 'error') {
        throw new ServiceUnavailableException({
          statusCode: 503,
          code: UPLOAD_REJECT_CODES.SCANNER_UNAVAILABLE,
          message: 'Virus scanner unavailable',
        });
      }

      const id = randomUUID();
      accepted.push({
        id,
        originalName,
        storedName: `${id}${extension}`,
        mimeType: detected.mime,
        size: file.size,
        scanned: scanner.isScanningEnabled,
      });
    } finally {
      await removeTempUpload(file.tempPath);
    }
  }

  return accepted;
}

function sanitizeOriginalName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'file';
  return base.replace(/[^\w.\-()+ ]+/g, '_').slice(0, 200) || 'file';
}

function mimeMatchesExtension(mime: string, extension: string): boolean {
  const allowedExtensions = Object.entries({
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/webp': ['.webp'],
    'image/gif': ['.gif'],
    'application/pdf': ['.pdf'],
  }).find(([allowedMime]) => allowedMime === mime)?.[1];
  return allowedExtensions?.includes(extension) ?? false;
}
