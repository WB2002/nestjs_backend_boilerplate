export const UPLOAD_REJECT_CODES = {
  MAX_FILES_EXCEEDED: 'MAX_FILES_EXCEEDED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  TOTAL_SIZE_EXCEEDED: 'TOTAL_SIZE_EXCEEDED',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  EMPTY_FILE: 'EMPTY_FILE',
  MALWARE_DETECTED: 'MALWARE_DETECTED',
  SCANNER_UNAVAILABLE: 'SCANNER_UNAVAILABLE',
} as const;

export type UploadRejectCode =
  (typeof UPLOAD_REJECT_CODES)[keyof typeof UPLOAD_REJECT_CODES];

export type UploadValidationOptions = {
  maxFiles: number;
  maxFileSize: number;
  maxTotalSize: number;
  allowedMimeTypes: string[];
  allowedExtensions: string[];
  fieldName?: string;
};

export const DEFAULT_UPLOAD_OPTIONS: UploadValidationOptions = {
  maxFiles: 5,
  maxFileSize: 5_000_000,
  maxTotalSize: 20_000_000,
  allowedMimeTypes: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
  ],
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf'],
  fieldName: 'files',
};

export type IncomingUploadFile = {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer?: Buffer;
  tempPath?: string;
};

export type AcceptedUploadFile = {
  id: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  scanned: boolean;
};
