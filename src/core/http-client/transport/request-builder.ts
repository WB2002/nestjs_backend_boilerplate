import FormData from 'form-data';
import type { HttpRequest, QueryParamValue } from '../types';
import { assertPublicHttpUrl, UnsafeUrlError } from '@/common/sanitization';

export function buildUrl(options: {
  baseUrl?: string;
  url: string;
  path?: string;
  pathParams?: HttpRequest['pathParams'];
  query?: HttpRequest['query'];
}): string {
  const rawPath = options.path ?? options.url;
  const withParams = applyPathParams(rawPath, options.pathParams);
  const absolute = resolveAbsoluteUrl(withParams, options.baseUrl);
  appendQueryParams(absolute, options.query);
  return absolute.toString();
}

function resolveAbsoluteUrl(pathOrUrl: string, baseUrl?: string): URL {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    if (!baseUrl) {
      throw new Error('baseUrl is required for outbound requests');
    }
    const absolute = new URL(pathOrUrl);
    const base = parseHttpBaseUrl(baseUrl);
    if (absolute.origin !== base.origin) {
      throw new Error(
        'Absolute request URL origin must match configured baseUrl',
      );
    }
    assertWithinBasePath(absolute, base);
    assertSafeOutboundUrl(absolute);
    return absolute;
  }
  if (baseUrl) {
    const base = parseHttpBaseUrl(ensureTrailingSlash(baseUrl));
    const absolute = new URL(pathOrUrl.replace(/^\//, ''), base);
    if (absolute.origin !== base.origin) {
      throw new Error(
        'Absolute request URL origin must match configured baseUrl',
      );
    }
    assertWithinBasePath(absolute, base);
    assertSafeOutboundUrl(absolute);
    return absolute;
  }
  throw new Error('Absolute URL or base URL is required');
}

function parseHttpBaseUrl(baseUrl: string): URL {
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error('baseUrl must use http or https');
  }
  assertSafeOutboundUrl(base);
  return base;
}

/**
 * Shared SSRF checks. Private/loopback bases are allowed when
 * HTTP_CLIENT_ALLOW_PRIVATE_URLS=true (internal mesh / local tests).
 */
function assertSafeOutboundUrl(url: URL): void {
  if (process.env.HTTP_CLIENT_ALLOW_PRIVATE_URLS === 'true') {
    if (url.username || url.password) {
      throw new Error('URL must not contain credentials');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('baseUrl must use http or https');
    }
    return;
  }
  try {
    assertPublicHttpUrl(url.toString());
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      throw new Error(err.message);
    }
    throw err;
  }
}

/** Reject same-origin path escape from a path-scoped baseUrl (e.g. ../, ..%2f). */
function assertWithinBasePath(absolute: URL, base: URL): void {
  const basePath = canonicalizePathname(base.pathname);
  const resolvedPath = canonicalizePathname(absolute.pathname);
  if (basePath === '/') {
    return;
  }
  if (resolvedPath !== basePath && !resolvedPath.startsWith(`${basePath}/`)) {
    throw new Error('Request URL path must stay under configured baseUrl path');
  }
}

/**
 * Decode percent-encoding (bounded) and resolve `.` / `..` segments so
 * encoded traversals like `..%2f` cannot bypass prefix checks.
 */
function canonicalizePathname(pathname: string): string {
  let decoded = pathname.replace(/\\/g, '/');
  for (let i = 0; i < 5; i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next.replace(/\\/g, '/');
    } catch {
      break;
    }
  }

  const stack: string[] = [];
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return `/${stack.join('/')}`;
}

function appendQueryParams(absolute: URL, query?: HttpRequest['query']): void {
  if (!query) {
    return;
  }
  for (const [key, value] of Object.entries(query)) {
    appendQueryValue(absolute, key, value);
  }
}

function appendQueryValue(
  absolute: URL,
  key: string,
  value: QueryParamValue,
): void {
  if (value == null) {
    return;
  }
  if (Array.isArray(value)) {
    for (const queryValue of value) {
      absolute.searchParams.append(key, String(queryValue));
    }
    return;
  }
  absolute.searchParams.set(key, String(value));
}

export function applyPathParams(
  path: string,
  pathParams?: HttpRequest['pathParams'],
): string {
  if (!pathParams) {
    return path;
  }
  return path.replace(/:(\w+)|\{(\w+)\}/g, (match, a: string, b: string) => {
    const key = a ?? b;
    const value = Object.prototype.hasOwnProperty.call(pathParams, key)
      ? pathParams[key as keyof typeof pathParams]
      : undefined;
    if (value == null) {
      return match;
    }
    return encodeURIComponent(String(value));
  });
}

export function buildRequestBody(request: HttpRequest): {
  requestBody?: unknown;
  headers: Record<string, string>;
} {
  const headers = normalizeHeaders(request.headers);

  if (request.multipart?.length) {
    return buildMultipartBody(request, headers);
  }

  if (request.formData) {
    return buildFormUrlEncodedBody(request, headers);
  }

  return {
    requestBody: request.body,
    headers,
  };
}

function buildMultipartBody(
  request: HttpRequest,
  headers: Record<string, string>,
): { requestBody: FormData; headers: Record<string, string> } {
  const form = new FormData();
  for (const field of request.multipart ?? []) {
    const appendOptions: { filename?: string; contentType?: string } = {};
    if (field.filename !== undefined) {
      appendOptions.filename = field.filename;
    }
    if (field.contentType !== undefined) {
      appendOptions.contentType = field.contentType;
    }
    form.append(
      field.name,
      field.value as string | Buffer,
      Object.keys(appendOptions).length > 0 ? appendOptions : undefined,
    );
  }
  return {
    requestBody: form,
    headers: {
      ...headers,
      ...form.getHeaders(),
    },
  };
}

function buildFormUrlEncodedBody(
  request: HttpRequest,
  headers: Record<string, string>,
): { requestBody: string; headers: Record<string, string> } {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(request.formData ?? {})) {
    params.set(key, String(value));
  }
  return {
    requestBody: params.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
  };
}

export function normalizeHeaders(
  headers?: HttpRequest['headers'],
): Record<string, string> {
  if (!headers) {
    return {};
  }
  const builtHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) {
      continue;
    }
    builtHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return builtHeaders;
}

export function normalizeResponseHeaders(
  headers: Record<string, unknown>,
): Record<string, string> {
  const builtHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) {
      continue;
    }
    builtHeaders[key.toLowerCase()] = Array.isArray(value)
      ? value.join(', ')
      : String(value);
  }
  return builtHeaders;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}
