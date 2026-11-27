import { BadRequestException } from '@nestjs/common';
import { AjvValidationPipe } from '@/common/validation';
import { resetAppAjvForTests } from '@/common/validation';
import { uploadQuerySchema } from '../upload-query.dto';

describe('uploadQuerySchema', () => {
  beforeEach(() => {
    resetAppAjvForTests();
  });

  it('accepts optional clientRequestId up to 128 characters', () => {
    const pipe = new AjvValidationPipe(uploadQuerySchema);
    const id = 'a'.repeat(128);
    expect(pipe.transform({ clientRequestId: id })).toEqual({
      clientRequestId: id,
    });
  });

  it('rejects clientRequestId longer than 128 characters', () => {
    const pipe = new AjvValidationPipe(uploadQuerySchema);
    expect(() => pipe.transform({ clientRequestId: 'a'.repeat(129) })).toThrow(
      BadRequestException,
    );
  });
});
