import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConformanceHarnessAuthGuard } from './guards/conformance-harness-auth.guard';
import { redactForLog, redactOtelAttributes } from '@/core/redaction';
import { ConformanceRedactionRequestDto } from './dto';

const MAX_FLATTEN_DEPTH = 4;

type DottedPrimitiveValue = string | number | boolean;

function isRecordObject(
  targetValue: unknown,
): targetValue is Record<string, unknown> {
  return (
    typeof targetValue === 'object' &&
    targetValue !== null &&
    !Array.isArray(targetValue) &&
    !(targetValue instanceof Date) &&
    !Buffer.isBuffer(targetValue)
  );
}

function isPrimitiveAttributeValue(
  targetValue: unknown,
): targetValue is DottedPrimitiveValue {
  const targetType = typeof targetValue;
  return (
    targetType === 'string' ||
    targetType === 'number' ||
    targetType === 'boolean'
  );
}

function flattenToDottedEntries(
  payload: Record<string, unknown>,
  prefix = '',
  currentDepth = 1,
  accumulatedEntries: Array<[string, DottedPrimitiveValue]> = [],
): Array<[string, DottedPrimitiveValue]> {
  for (const [key, childValue] of Object.entries(payload)) {
    const dottedKey = prefix.length > 0 ? `${prefix}.${key}` : key;
    if (isRecordObject(childValue)) {
      if (currentDepth < MAX_FLATTEN_DEPTH) {
        flattenToDottedEntries(
          childValue,
          dottedKey,
          currentDepth + 1,
          accumulatedEntries,
        );
      }
    } else if (isPrimitiveAttributeValue(childValue)) {
      accumulatedEntries.push([dottedKey, childValue]);
    }
  }
  return accumulatedEntries;
}

function flattenToDottedKeys(
  payload: Record<string, unknown>,
): Record<string, DottedPrimitiveValue> {
  return Object.fromEntries(flattenToDottedEntries(payload));
}

export interface ConformanceRedactionResponse {
  redactedPayload: Record<string, unknown>;
  redactedSpanAttributes: ReturnType<typeof redactOtelAttributes>;
}

@UseGuards(ConformanceHarnessAuthGuard)
@Controller('conformance/redaction')
export class ConformanceRedactionController {
  private readonly logger = new Logger(ConformanceRedactionController.name);

  @Post()
  @HttpCode(200)
  redact(
    @Body() request: ConformanceRedactionRequestDto,
  ): ConformanceRedactionResponse {
    this.logger.log({ conformancePayload: request.payload });
    return {
      redactedPayload: redactForLog(request.payload) as Record<string, unknown>,
      redactedSpanAttributes: redactOtelAttributes(
        flattenToDottedKeys(request.payload),
      ),
    };
  }
}
