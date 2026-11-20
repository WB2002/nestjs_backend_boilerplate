import { Controller, Post, Req, BadRequestException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import '@fastify/multipart';
import { ApiPriority, ApiPriorityLevel } from '@/core/overload';
import { UploadsService } from './uploads.service';
import { removeTempUpload, streamMultipartToTempFile } from './read-file-bytes';
import type { IncomingUploadFile } from './upload.types';
import { UPLOAD_REJECT_CODES } from './upload.types';
import { UploadValidationError } from './validate-upload-files';

/**
 * Example multi-file upload endpoint.
 *
 * Usage:
 *   curl -X POST http://localhost:3000/uploads \
 *     -H "Authorization: Bearer <accessToken>" \
 *     -F "files=@./a.png" \
 *     -F "files=@./b.pdf"
 *
 * Limits (env): UPLOAD_MAX_FILES, UPLOAD_MAX_FILE_SIZE, UPLOAD_MAX_TOTAL_SIZE
 * Virus scan: set UPLOAD_VIRUS_SCAN=true and run the clamav compose service.
 *
 * Response is metadata only (buffers are discarded after validation/scan).
 */
@ApiPriority(ApiPriorityLevel.Low)
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post()
  async upload(@Req() req: FastifyRequest) {
    const options = this.uploadsService.resolveOptions();
    const files = await readMultipartFiles(req, options);
    const accepted = await this.uploadsService.processFiles(files, options);
    return {
      files: accepted.map((f) => ({
        id: f.id,
        originalName: f.originalName,
        mimeType: f.mimeType,
        size: f.size,
        scanned: f.scanned,
      })),
    };
  }
}

async function readMultipartFiles(
  req: FastifyRequest,
  options: {
    maxFiles: number;
    maxFileSize: number;
    maxTotalSize: number;
    fieldName?: string;
  },
): Promise<IncomingUploadFile[]> {
  if (typeof req.parts !== 'function') {
    throw new BadRequestException('Multipart support is not enabled');
  }

  const fieldName = options.fieldName ?? 'files';
  const files: IncomingUploadFile[] = [];
  let totalSize = 0;

  for await (const part of req.parts()) {
    if (part.type !== 'file') {
      // Drain non-file fields so the multipart parser cannot stall.
      await part.value;
      continue;
    }
    if (part.fieldname !== fieldName) {
      await part.toBuffer();
      continue;
    }

    if (files.length >= options.maxFiles) {
      await part.toBuffer();
      throw new UploadValidationError(
        UPLOAD_REJECT_CODES.MAX_FILES_EXCEEDED,
        `At most ${options.maxFiles} files are allowed`,
      );
    }

    let tempPath: string | undefined;
    let size = 0;
    try {
      const streamed = await streamMultipartToTempFile(
        part.file,
        options.maxFileSize,
      );
      tempPath = streamed.tempPath;
      size = streamed.size;
    } catch {
      await removeTempUpload(tempPath);
      throw new UploadValidationError(
        UPLOAD_REJECT_CODES.FILE_TOO_LARGE,
        `Each file must be at most ${options.maxFileSize} bytes`,
      );
    }

    totalSize += size;
    if (totalSize > options.maxTotalSize) {
      await removeTempUpload(tempPath);
      throw new UploadValidationError(
        UPLOAD_REJECT_CODES.TOTAL_SIZE_EXCEEDED,
        `Total upload size must be at most ${options.maxTotalSize} bytes`,
      );
    }

    files.push({
      fieldname: part.fieldname,
      originalname: part.filename || 'file',
      mimetype: part.mimetype || 'application/octet-stream',
      tempPath,
      size,
    });
  }
  return files;
}
