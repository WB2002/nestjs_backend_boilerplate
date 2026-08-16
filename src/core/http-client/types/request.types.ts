export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export type ResponseType = 'json' | 'text' | 'binary' | 'stream';

export type HttpHeaders = Record<string, string | string[] | undefined>;

export type QueryParamPrimitive = string | number | boolean;
export type QueryParamValue =
  | QueryParamPrimitive
  | QueryParamPrimitive[]
  | null;

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  path?: string;
  pathParams?: Record<string, string | number | boolean>;
  query?: Record<string, QueryParamValue>;
  headers?: HttpHeaders;
  body?: unknown;
  formData?: Record<string, string | number | boolean>;
  multipart?: MultipartField[];
  responseType?: ResponseType;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type HttpRequestOptions = Omit<HttpRequest, 'method' | 'url'>;
export type HttpBodyRequestOptions = Omit<
  HttpRequest,
  'method' | 'url' | 'body'
>;

export interface MultipartField {
  name: string;
  value: string | Buffer | NodeJS.ReadableStream;
  filename?: string;
  contentType?: string;
}

export interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: T;
  ok: boolean;
}

export interface TransportRequestOptions {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}
