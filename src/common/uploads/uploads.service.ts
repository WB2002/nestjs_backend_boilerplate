import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FILE_SCANNER, FileScanner } from './scanners/file-scanner';
import {
  AcceptedUploadFile,
  DEFAULT_UPLOAD_OPTIONS,
  IncomingUploadFile,
  UploadValidationOptions,
} from './upload.types';
import { validateUploadFiles } from './validate-upload-files';

@Injectable()
export class UploadsService {
  constructor(
    private readonly configService: ConfigService,
    @Inject(FILE_SCANNER) private readonly scanner: FileScanner,
  ) {}

  async processFiles(
    files: IncomingUploadFile[],
    overrides?: Partial<UploadValidationOptions>,
  ): Promise<AcceptedUploadFile[]> {
    const options = this.resolveOptions(overrides);
    return validateUploadFiles(files, options, this.scanner);
  }

  resolveOptions(
    overrides?: Partial<UploadValidationOptions>,
  ): UploadValidationOptions {
    const maxFiles = this.readPositiveInt(
      'UPLOAD_MAX_FILES',
      DEFAULT_UPLOAD_OPTIONS.maxFiles,
    );
    const maxFileSize = this.readPositiveInt(
      'UPLOAD_MAX_FILE_SIZE',
      DEFAULT_UPLOAD_OPTIONS.maxFileSize,
    );
    const maxTotalSize = this.readPositiveInt(
      'UPLOAD_MAX_TOTAL_SIZE',
      DEFAULT_UPLOAD_OPTIONS.maxTotalSize,
    );

    return {
      ...DEFAULT_UPLOAD_OPTIONS,
      maxFiles,
      maxFileSize,
      maxTotalSize,
      ...overrides,
    };
  }

  private readPositiveInt(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key);
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
