import * as winston from 'winston';
import { isString, isObject, get } from 'lodash';
import { LoggerContext } from './logger.context';
import { LOG_COLOR_MAPPER } from '@/common/constants';
import { parseLogRedactionConfig } from '@/core/redaction/parse-log-redaction-config';
import { redactForLog } from '@/core/redaction/redact-deep';
import { redactLogMessage } from '@/core/redaction/redact-log-message';
import type { LogRedactionConfig } from '@/core/redaction/parse-log-redaction-config';

const { combine, timestamp, printf, json, colorize } = winston.format;

const WINSTON_RESERVED = new Set(['level', 'message', 'timestamp', 'stack']);

export function createRedactionFormat(config: LogRedactionConfig) {
  return winston.format((info) => {
    if (!config.enabled) {
      return info;
    }
    if (typeof info.message === 'string') {
      info.message = redactLogMessage(info.message);
    }
    if (typeof info.stack === 'string') {
      info.stack = redactLogMessage(info.stack);
    }
    let redactedEntries: Array<[string, unknown]> | undefined;
    for (const [key, value] of Object.entries(info)) {
      if (WINSTON_RESERVED.has(key)) {
        continue;
      }
      if (
        (key === 'context' || key === 'method') &&
        typeof value === 'string'
      ) {
        continue;
      }
      const nextValue = redactForLog(value);
      if (nextValue !== value) {
        redactedEntries ??= [];
        redactedEntries.push([key, nextValue]);
      }
    }
    if (!redactedEntries) {
      return info;
    }
    return { ...info, ...Object.fromEntries(redactedEntries) };
  });
}

const contextFormatter = winston.format((info) => {
  const storageContext = LoggerContext.get();
  // Merge storage context (requestId, class, method) into Winston's info
  // Storage context takes priority for 'context' and 'method' to ensure accuracy
  return { ...info, ...storageContext };
});

const logRedactionConfig = parseLogRedactionConfig(process.env);
const redactionFormat = createRedactionFormat(logRedactionConfig);

const devFormat = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  redactionFormat(),
  contextFormatter(),
  colorize(),
  printf(({ timestamp, level, message, context, method, stack, ...meta }) => {
    let className = '';
    let methodName = method || '';

    if (isString(context)) {
      className = context;
    } else if (isObject(context)) {
      className = get(context, 'context', '');
      methodName = methodName || get(context, 'method', '');
    }

    const label = [className, methodName].filter(Boolean).join('::');
    const formattedContext = label
      ? ` ${LOG_COLOR_MAPPER.context}[${label}]${LOG_COLOR_MAPPER.reset}`
      : '';

    const { requestId, userId, ...remainingMeta } = meta as Record<
      string,
      unknown
    >;
    const tracingInfo = [
      requestId
        ? `${LOG_COLOR_MAPPER.requestId}requestId: ${LOG_COLOR_MAPPER.reset}${requestId}`
        : '',
      userId
        ? `${LOG_COLOR_MAPPER.userId}userId: ${LOG_COLOR_MAPPER.reset}${userId}`
        : '',
    ]
      .filter(Boolean)
      .join(' ');

    const formattedMetadata = Object.keys(remainingMeta).length
      ? ` ${JSON.stringify(remainingMeta)}`
      : '';
    const formattedTracing = tracingInfo ? ` (${tracingInfo})` : '';

    const stackSuffix = stack ? `\n${stack}` : '';
    return (
      `${LOG_COLOR_MAPPER.timestamp}${timestamp}${LOG_COLOR_MAPPER.reset}` +
      `${formattedContext} ${level}: ${message}${formattedTracing}${formattedMetadata}${stackSuffix}`
    );
  }),
);

const prodFormat = combine(
  timestamp(),
  redactionFormat(),
  contextFormatter(),
  json(),
);

export const winstonConfig = {
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
    }),
  ],
};
