import { BadRequestException } from '@nestjs/common';
import { sanitizeHtmlString } from './sanitize-html.utils';
import { looksLikeSqlInjection } from './sql-injection.utils';
import { assertPublicHttpUrlAsync, UnsafeUrlError } from './ssrf.utils';
import {
  DEFAULT_SKIP_KEYS,
  REJECT_SQL_INJECTION_KEY,
  SAFE_URL_KEY,
  SANITIZE_HTML_KEY,
  SKIP_SANITIZATION_KEY,
  SKIP_SQL_INJECTION_KEY,
} from '../constants';
import type {
  PropertyFlags,
  SanitizeHtmlOptions,
  WalkSanitizationOptions,
} from '../types';

export type { WalkSanitizationOptions } from '../types';

/**
 * Recursively sanitize/reject string values in plain objects and arrays.
 * Async so @SafeUrl can resolve DNS.
 */
export async function walkAndSanitize(
  value: unknown,
  options: WalkSanitizationOptions = {},
  currentKey?: string,
  seen: WeakSet<object> = new WeakSet(),
): Promise<unknown> {
  if (value == null) {
    return value;
  }

  if (typeof value === 'string') {
    return sanitizeStringValue(value, options, currentKey);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
    return Promise.all(
      value.map((item) => walkAndSanitize(item, options, currentKey, seen)),
    );
  }

  if (typeof value === 'object') {
    if (value instanceof Date || Buffer.isBuffer(value)) {
      return value;
    }
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);

    const record = value as Record<string, unknown>;
    // Prefer this object's own DTO prototype so nested class instances
    // get correct per-property metadata (@SkipSanitization, @SafeUrl, …).
    let effectiveOptions = options;
    const proto = Object.getPrototypeOf(value) as object | null;
    if (
      proto &&
      proto !== Object.prototype &&
      proto !== Array.prototype
    ) {
      effectiveOptions = { ...options, metadataTarget: proto };
    } else if (options.metadataTarget && currentKey) {
      const NestedType = Reflect.getMetadata(
        'design:type',
        options.metadataTarget,
        currentKey,
      ) as (new (...args: never[]) => unknown) | undefined;
      if (
        NestedType &&
        NestedType !== Object &&
        NestedType !== Array &&
        NestedType !== String &&
        NestedType !== Number &&
        NestedType !== Boolean &&
        NestedType.prototype
      ) {
        effectiveOptions = {
          ...options,
          metadataTarget: NestedType.prototype as object,
        };
      }
    }

    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) {
      out[key] = await walkAndSanitize(nested, effectiveOptions, key, seen);
    }
    if (proto && proto !== Object.prototype) {
      Object.assign(value as object, out);
      return value;
    }
    return out;
  }

  return value;
}

function readPropertyFlags(
  metadataTarget: object | undefined,
  currentKey: string | undefined,
): PropertyFlags {
  if (!metadataTarget || currentKey == null) {
    return {};
  }
  const skip = Reflect.getMetadata(
    SKIP_SANITIZATION_KEY,
    metadataTarget,
    currentKey,
  ) as boolean | undefined;
  const htmlOptions = Reflect.getMetadata(
    SANITIZE_HTML_KEY,
    metadataTarget,
    currentKey,
  ) as SanitizeHtmlOptions | undefined;
  const safeUrl = Reflect.getMetadata(
    SAFE_URL_KEY,
    metadataTarget,
    currentKey,
  ) as boolean | undefined;
  const rejectSqlInjection = Reflect.getMetadata(
    REJECT_SQL_INJECTION_KEY,
    metadataTarget,
    currentKey,
  ) as boolean | undefined;
  const skipSqlInjection = Reflect.getMetadata(
    SKIP_SQL_INJECTION_KEY,
    metadataTarget,
    currentKey,
  ) as boolean | undefined;

  return {
    ...(skip ? { skip: true } : {}),
    ...(htmlOptions !== undefined ? { htmlOptions } : {}),
    ...(safeUrl ? { safeUrl: true } : {}),
    ...(rejectSqlInjection ? { rejectSqlInjection: true } : {}),
    ...(skipSqlInjection ? { skipSqlInjection: true } : {}),
  };
}

async function sanitizeStringValue(
  value: string,
  options: WalkSanitizationOptions,
  currentKey?: string,
): Promise<string> {
  const flags = readPropertyFlags(options.metadataTarget, currentKey);
  const skipKeys = options.skipKeys ?? DEFAULT_SKIP_KEYS;

  if (flags.skip || (currentKey != null && skipKeys.has(currentKey))) {
    return value;
  }

  let rejectSql =
    flags.rejectSqlInjection ?? options.rejectSqlInjection ?? true;
  if (flags.skipSqlInjection) {
    rejectSql = false;
  }
  if (rejectSql && looksLikeSqlInjection(value)) {
    throw new BadRequestException('Potentially malicious input rejected');
  }

  const enforceSafeUrl = flags.safeUrl ?? options.enforceSafeUrl ?? false;
  if (enforceSafeUrl) {
    try {
      await assertPublicHttpUrlAsync(value);
    } catch (err) {
      if (err instanceof UnsafeUrlError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
    return value;
  }

  const htmlOptions = flags.htmlOptions ?? options.htmlOptions;
  return sanitizeHtmlString(value, htmlOptions);
}
