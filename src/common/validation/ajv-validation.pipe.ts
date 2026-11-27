import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { AnySchema, ValidateFunction } from 'ajv';
import { getAppAjv } from './app-ajv';
import { formatAjvErrors } from './format-ajv-errors';

@Injectable()
export class AjvValidationPipe implements PipeTransform {
  private readonly validate: ValidateFunction;

  constructor(schema: AnySchema) {
    this.validate = getAppAjv().compile(schema);
  }

  transform(value: unknown): unknown {
    const payload = value === undefined || value === null ? {} : value;

    if (this.validate(payload)) {
      return payload;
    }

    throw new BadRequestException(formatAjvErrors(this.validate.errors));
  }
}
