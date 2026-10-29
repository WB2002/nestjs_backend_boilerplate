import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  ResponseType as AxiosResponseType,
} from 'axios';
import type {
  HttpRequest,
  HttpResponse,
  ResponseType,
  TransportRequestOptions,
} from '../types';
import { normalizeError } from '../errors';
import type { AgentBundle } from './connection-pool.registry';
import {
  buildRequestBody,
  buildUrl,
  normalizeResponseHeaders,
} from './request-builder';
import { withoutUndefined } from '../utils/without-undefined';

export class AxiosTransport {
  private readonly instance: AxiosInstance;

  constructor(private readonly agents: AgentBundle) {
    this.instance = axios.create({
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
      validateStatus: () => true,
      maxRedirects: 0,
      transitional: {
        clarifyTimeoutError: true,
      },
    });
  }

  async request<T = unknown>(
    request: HttpRequest,
    options: TransportRequestOptions = {},
  ): Promise<HttpResponse<T>> {
    const url = buildUrl(
      withoutUndefined({
        baseUrl: options.baseUrl,
        url: request.url,
        path: request.path,
        pathParams: request.pathParams,
        query: request.query,
      }),
    );
    const { requestBody, headers } = buildRequestBody({
      ...request,
      headers: {
        ...options.defaultHeaders,
        ...request.headers,
      },
    });

    const config: AxiosRequestConfig = withoutUndefined({
      method: request.method,
      url,
      headers,
      // eslint-disable-next-line id-denylist -- Axios request config body field
      data: requestBody,
      timeout: request.timeoutMs ?? options.timeoutMs,
      signal: request.signal ?? options.signal,
      responseType: toAxiosResponseType(request.responseType),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    try {
      const response = await this.instance.request<T>(config);
      return toHttpResponse(response);
    } catch (error) {
      throw normalizeError(error, {
        method: request.method,
        url,
      });
    }
  }

  async bareRequest<T = unknown>(
    config: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.instance.request<T>({
      ...config,
      httpAgent: this.agents.httpAgent,
      httpsAgent: this.agents.httpsAgent,
      validateStatus: () => true,
    });
  }

  close(): void {
    this.agents.release();
  }
}

function toAxiosResponseType(
  responseType?: ResponseType,
): AxiosResponseType | undefined {
  switch (responseType) {
    case 'text':
      return 'text';
    case 'binary':
      return 'arraybuffer';
    case 'stream':
      return 'stream';
    case 'json':
    default:
      return responseType === undefined ? undefined : 'json';
  }
}

function toHttpResponse<T>(response: AxiosResponse<T>): HttpResponse<T> {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: normalizeResponseHeaders(
      response.headers as Record<string, unknown>,
    ),
    body: response.data,
    ok: response.status >= 200 && response.status < 300,
  };
}
