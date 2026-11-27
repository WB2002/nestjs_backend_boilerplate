import { BadRequestException } from '@nestjs/common';
import type { JSONSchemaType } from 'ajv';
import { AjvValidationPipe } from '../ajv-validation.pipe';
import { resetAppAjvForTests } from '../app-ajv';

type QueryShape = {
  label?: string;
};

const querySchema: JSONSchemaType<QueryShape> = {
  type: 'object',
  properties: {
    label: { type: 'string', maxLength: 8 },
  },
  additionalProperties: false,
};

describe('AjvValidationPipe', () => {
  beforeEach(() => {
    resetAppAjvForTests();
  });

  it('passes through valid query objects', () => {
    const pipe = new AjvValidationPipe(querySchema);
    expect(pipe.transform({ label: 'ok' })).toEqual({ label: 'ok' });
  });

  it('treats missing query as an empty object', () => {
    const pipe = new AjvValidationPipe(querySchema);
    expect(pipe.transform(undefined)).toEqual({});
  });

  it('rejects unknown fields via additionalProperties: false', () => {
    const pipe = new AjvValidationPipe(querySchema);
    expect(() => pipe.transform({ extra: 'x' })).toThrow(BadRequestException);
  });

  it('rejects values that violate schema constraints', () => {
    const pipe = new AjvValidationPipe(querySchema);
    expect(() => pipe.transform({ label: 'too-long-label' })).toThrow(
      BadRequestException,
    );
  });
});
