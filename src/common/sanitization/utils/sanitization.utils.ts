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

function resolveWalkSanitizationOptions(
  value: object,
  options: WalkSanitizationOptions,
  currentKey?: string,
): WalkSanitizationOptions {
  const proto = Object.getPrototypeOf(value) as object | null;
  if (proto && proto !== Object.prototype && proto !== Array.prototype) {
    return { ...options, metadataTarget: proto };
  }
  if (!options.metadataTarget || !currentKey) {
    return options;
  }
  const nestedPropertyType = Reflect.getMetadata(
    'design:type',
    options.metadataTarget,
    currentKey,
  ) as (new (...args: never[]) => unknown) | undefined;
  if (
    !nestedPropertyType ||
    nestedPropertyType === Object ||
    nestedPropertyType === Array ||
    nestedPropertyType === String ||
    nestedPropertyType === Number ||
    nestedPropertyType === Boolean ||
    !nestedPropertyType.prototype
  ) {
    return options;
  }
  return {
    ...options,
    metadataTarget: nestedPropertyType.prototype as object,
  };
}

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
      value.map((arrayElement) =>
        walkAndSanitize(arrayElement, options, currentKey, seen),
      ),
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
    const proto = Object.getPrototypeOf(value) as object | null;
    const effectiveOptions = resolveWalkSanitizationOptions(
      value,
      options,
      currentKey,
    );

    const sanitizedEntries = await Promise.all(
      Object.entries(record).map(
        async ([key, nested]) =>
          [
            key,
            await walkAndSanitize(nested, effectiveOptions, key, seen),
          ] as const,
      ),
    );
    const out = Object.fromEntries(sanitizedEntries);
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
  const shouldSkip = Reflect.getMetadata(
    SKIP_SANITIZATION_KEY,
    metadataTarget,
    currentKey,
  ) as boolean | undefined;
  const htmlOptions = Reflect.getMetadata(
    SANITIZE_HTML_KEY,
    metadataTarget,
    currentKey,
  ) as SanitizeHtmlOptions | undefined;
  const isSafeUrl = Reflect.getMetadata(
    SAFE_URL_KEY,
    metadataTarget,
    currentKey,
  ) as boolean | undefined;
  const shouldRejectSqlInjection = Reflect.getMetadata(
    REJECT_SQL_INJECTION_KEY,
    metadataTarget,
    currentKey,
  ) as boolean | undefined;
  const shouldSkipSqlInjection = Reflect.getMetadata(
    SKIP_SQL_INJECTION_KEY,
    metadataTarget,
    currentKey,
  ) as boolean | undefined;

  return {
    ...(shouldSkip ? { shouldSkip: true } : {}),
    ...(htmlOptions !== undefined ? { htmlOptions } : {}),
    ...(isSafeUrl ? { isSafeUrl: true } : {}),
    ...(shouldRejectSqlInjection ? { shouldRejectSqlInjection: true } : {}),
    ...(shouldSkipSqlInjection ? { shouldSkipSqlInjection: true } : {}),
  };
}

async function sanitizeStringValue(
  value: string,
  options: WalkSanitizationOptions,
  currentKey?: string,
): Promise<string> {
  const flags = readPropertyFlags(options.metadataTarget, currentKey);
  const skipKeys = options.skipKeys ?? DEFAULT_SKIP_KEYS;

  if (flags.shouldSkip || (currentKey != null && skipKeys.has(currentKey))) {
    return value;
  }

  let shouldRejectSql =
    flags.shouldRejectSqlInjection ?? options.rejectSqlInjection ?? true;
  if (flags.shouldSkipSqlInjection) {
    shouldRejectSql = false;
  }
  if (shouldRejectSql && looksLikeSqlInjection(value)) {
    throw new BadRequestException('Potentially malicious input rejected');
  }

  const shouldEnforceSafeUrl =
    flags.isSafeUrl ?? options.enforceSafeUrl ?? false;
  if (shouldEnforceSafeUrl) {
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
