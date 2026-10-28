import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import 'reflect-metadata';
import { walkAndSanitize } from '../utils';

@Injectable()
export class SanitizationPipe implements PipeTransform {
  async transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<unknown> {
    if (value == null) {
      return value;
    }

    // GraphQL @Args maps to 'body'. Do not walk 'custom' (@Req/@Res) — those
    // objects cycle through sockets and would hang the request.
    if (
      metadata.type !== 'body' &&
      metadata.type !== 'query' &&
      metadata.type !== 'param'
    ) {
      return value;
    }

    const metadataTarget =
      metadata.metatype &&
      metadata.metatype !== Object &&
      metadata.metatype !== String &&
      metadata.metatype !== Number &&
      metadata.metatype !== Boolean
        ? metadata.metatype.prototype
        : undefined;

    return walkAndSanitize(value, {
      ...(metadataTarget ? { metadataTarget } : {}),
    });
  }
}
