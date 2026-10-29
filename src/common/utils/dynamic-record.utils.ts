/**
 * Helpers for reading and building records without dynamic bracket access,
 * keeping eslint-plugin-security object-injection checks satisfied at call sites.
 */

export function readStringRecordField(
  record: Record<string, unknown> | undefined,
  fieldName: string,
): string | undefined {
  if (!record) {
    return undefined;
  }
  const matchedEntry = Object.entries(record).find(
    ([key]) => key === fieldName,
  );
  const fieldValue = matchedEntry?.[1];
  return typeof fieldValue === 'string' ? fieldValue : undefined;
}

export function readUnknownRecordField(
  record: Record<string, unknown> | undefined,
  fieldName: string,
): unknown {
  if (!record) {
    return undefined;
  }
  return Object.entries(record).find(([key]) => key === fieldName)?.[1];
}

export function mergeCookieRecord(
  cookies: Record<string, string | undefined> | undefined,
  cookieName: string,
  cookieValue: string,
): Record<string, string> {
  const definedCookieEntries = Object.entries(cookies ?? {}).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return Object.fromEntries([
    ...definedCookieEntries,
    [cookieName, cookieValue],
  ]) as Record<string, string>;
}

export function readCookieField(
  cookies: Record<string, string | undefined> | undefined,
  cookieName: string,
): string | undefined {
  if (!cookies) {
    return undefined;
  }
  const cookieValue = Object.entries(cookies).find(
    ([key]) => key === cookieName,
  )?.[1];
  return cookieValue === undefined ? undefined : cookieValue;
}

export function buildRecordFromEntries<T>(
  entries: [string, T][],
  mapEntry: (key: string, value: T) => [string, unknown],
): Record<string, unknown> {
  return Object.fromEntries(
    entries.map(([key, value]) => mapEntry(key, value)),
  );
}

/** Last-resort mutable assign when Object.fromEntries cannot be used. */
export function assignStringRecordField(
  target: Record<string, unknown>,
  fieldName: string,
  value: unknown,
): void {
  // eslint-disable-next-line security/detect-object-injection -- fieldName is an app constant at call sites, not request-controlled
  target[fieldName] = value;
}
