import { BadRequestException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { UploadsController } from '../uploads.controller';
import { UploadsService } from '../uploads.service';
import { UPLOAD_REJECT_CODES } from '../upload.types';

jest.mock('../read-file-bytes', () => ({
  streamMultipartToTempFile: jest.fn().mockResolvedValue({
    tempPath: 'upload-temp-fixture.bin',
    size: 12,
  }),
  removeTempUpload: jest.fn().mockResolvedValue(undefined),
}));

describe('UploadsController', () => {
  const defaultOptions = {
    maxFiles: 2,
    maxFileSize: 1000,
    maxTotalSize: 2000,
    fieldName: 'files',
  };

  const createController = () => {
    const uploadsService = {
      resolveOptions: jest.fn().mockReturnValue(defaultOptions),
      processFiles: jest.fn().mockResolvedValue([
        {
          id: 'file-1',
          originalName: 'a.png',
          mimeType: 'image/png',
          size: 12,
          scanned: false,
        },
      ]),
    } as unknown as UploadsService;

    return {
      controller: new UploadsController(uploadsService),
      uploadsService,
    };
  };

  function filePart(overrides?: Partial<Record<string, unknown>>) {
    return {
      type: 'file',
      fieldname: 'files',
      filename: 'a.png',
      mimetype: 'image/png',
      file: {},
      toBuffer: jest.fn().mockResolvedValue(Buffer.alloc(0)),
      value: undefined,
      ...overrides,
    };
  }

  function fieldPart() {
    return {
      type: 'field',
      fieldname: 'meta',
      value: Promise.resolve('note'),
    };
  }

  it('rejects when multipart support is missing on the request', async () => {
    const { controller } = createController();
    const request = {} as FastifyRequest;

    await expect(controller.upload({}, request)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns metadata for accepted multipart files', async () => {
    const { controller, uploadsService } = createController();
    const parts = async function* () {
      yield filePart();
    };
    const request = { parts } as unknown as FastifyRequest;

    const response = await controller.upload({}, request);

    expect(uploadsService.processFiles).toHaveBeenCalled();
    expect(response.files).toEqual([
      {
        id: 'file-1',
        originalName: 'a.png',
        mimeType: 'image/png',
        size: 12,
        scanned: false,
      },
    ]);
  });

  it('drains non-file multipart parts before processing file entries', async () => {
    const { controller } = createController();
    const field = fieldPart();
    const parts = async function* () {
      yield field;
      yield filePart();
    };
    const request = { parts } as unknown as FastifyRequest;

    await controller.upload({}, request);

    await field.value;
  });

  it('rejects when more files are uploaded than allowed', async () => {
    const { controller } = createController();
    const parts = async function* () {
      yield filePart();
      yield filePart({ filename: 'b.png' });
      yield filePart({ filename: 'c.png' });
    };
    const request = { parts } as unknown as FastifyRequest;

    await expect(controller.upload({}, request)).rejects.toMatchObject({
      code: UPLOAD_REJECT_CODES.MAX_FILES_EXCEEDED,
    });
  });
});
