import type { IOptions } from 'sanitize-html';

export type SanitizeHtmlOptions = IOptions;

export type WalkSanitizationOptions = {
  skipKeys?: Set<string>;
  htmlOptions?: SanitizeHtmlOptions;
  /** When true, reject strings that look like SQL injection. Default true. */
  rejectSqlInjection?: boolean;
  /** When true, treat every string as a URL and assert public http(s). */
  enforceSafeUrl?: boolean;
  /** DTO prototype used to read per-property Reflect metadata. */
  metadataTarget?: object;
};

export type PropertyFlags = {
  shouldSkip?: boolean;
  htmlOptions?: SanitizeHtmlOptions;
  isSafeUrl?: boolean;
  shouldRejectSqlInjection?: boolean;
  shouldSkipSqlInjection?: boolean;
};
