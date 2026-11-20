import { createReadStream } from 'node:fs';
import { access, readFile, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

export async function readUploadPrefix(
  file: { buffer?: Buffer; tempPath?: string },
  length: number,
): Promise<Buffer> {
  if (file.buffer) {
    return file.buffer.subarray(0, length);
  }
  if (file.tempPath) {
    const fileBytes = await readFile(file.tempPath); // eslint-disable-line security/detect-non-literal-fs-filename -- temp upload prefix read
    return fileBytes.subarray(0, length);
  }
  return Buffer.alloc(0);
}

export async function readUploadFullBuffer(file: {
  buffer?: Buffer;
  tempPath?: string;
}): Promise<Buffer> {
  if (file.buffer) {
    return file.buffer;
  }
  if (file.tempPath) {
    return readFile(file.tempPath); // eslint-disable-line security/detect-non-literal-fs-filename -- temp path from trusted os.tmpdir()
  }
  return Buffer.alloc(0);
}

export async function streamMultipartToTempFile(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<{ tempPath: string; size: number }> {
  const tempPath = join(tmpdir(), `upload-${randomUUID()}`);
  const writeStream = createWriteStream(tempPath); // eslint-disable-line security/detect-non-literal-fs-filename -- ephemeral upload staging
  let size = 0;

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        writeStream.destroy();
        reject(new Error('UPLOAD_SIZE_EXCEEDED'));
        return;
      }
      writeStream.write(chunk);
    });
    stream.on('end', () => {
      writeStream.end(() => resolve());
    });
    stream.on('error', reject);
    writeStream.on('error', reject);
  });

  return { tempPath, size };
}

export async function removeTempUpload(
  path: string | undefined,
): Promise<void> {
  if (!path) {
    return;
  }
  try {
    await access(path);
    await unlink(path); // eslint-disable-line security/detect-non-literal-fs-filename -- temp upload cleanup
  } catch {
    // ignore missing temp files
  }
}

export async function createReadStreamFromUpload(file: {
  buffer?: Buffer;
  tempPath?: string;
}): Promise<NodeJS.ReadableStream> {
  if (file.tempPath) {
    return createReadStream(file.tempPath); // eslint-disable-line security/detect-non-literal-fs-filename -- temp upload stream
  }
  const { Readable } = await import('node:stream');
  return Readable.from(file.buffer ?? Buffer.alloc(0));
}
