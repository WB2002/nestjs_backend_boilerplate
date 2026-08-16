import type { HttpMethod, HttpRequest, HttpResponse } from '../types';
import { isSensitiveHeaderName } from '../telemetry/redaction';
import { sha256Hex } from '../utils/fingerprint';

export interface CoalescingEntry {
  promise: Promise<HttpResponse>;
  consumers: number;
  abortController: AbortController;
}

export class RequestCoalescer {
  private readonly inflight = new Map<string, CoalescingEntry>();

  get size(): number {
    return this.inflight.size;
  }

  async run(
    key: string,
    execute: (signal: AbortSignal) => Promise<HttpResponse>,
    signal?: AbortSignal,
  ): Promise<HttpResponse> {
    const existing = this.inflight.get(key);
    if (existing) {
      existing.consumers += 1;
      return this.attachConsumer(existing, signal);
    }

    const abortController = new AbortController();
    const entry: CoalescingEntry = {
      promise: execute(abortController.signal).finally(() => {
        this.inflight.delete(key);
      }),
      consumers: 1,
      abortController,
    };
    this.inflight.set(key, entry);
    return this.attachConsumer(entry, signal);
  }

  clear(): void {
    for (const entry of this.inflight.values()) {
      entry.abortController.abort();
    }
    this.inflight.clear();
  }

  private async attachConsumer(
    entry: CoalescingEntry,
    signal?: AbortSignal,
  ): Promise<HttpResponse> {
    if (!signal) {
      return entry.promise;
    }

    return new Promise<HttpResponse>((resolve, reject) => {
      const onAbort = () => {
        entry.consumers -= 1;
        if (entry.consumers <= 0) {
          // Abort in-flight work but keep the map entry until the executor
          // settles so a concurrent re-entry cannot start a duplicate request.
          entry.abortController.abort(signal.reason);
        }
        reject(signal.reason ?? new Error('Request aborted'));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      entry.promise
        .then((result) => {
          signal.removeEventListener('abort', onAbort);
          resolve(result);
        })
        .catch((error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        });
    });
  }
}

export function defaultCoalescingKey(request: HttpRequest): string {
  const headers = normalizeHeadersForKey(request.headers);
  const query = normalizeQueryForKey(request.query);
  return [
    request.method,
    request.url,
    request.path ?? '',
    JSON.stringify(request.pathParams ?? {}),
    JSON.stringify(query),
    JSON.stringify(headers),
  ].join('|');
}

export function isDefaultCoalescable(method: HttpMethod): boolean {
  return method === 'GET' || method === 'HEAD';
}

function normalizeHeadersForKey(
  headers?: Record<string, string | string[] | undefined>,
): Record<string, string> {
  if (!headers) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) {
      continue;
    }
    const normalized = Array.isArray(value) ? value.join(',') : value;
    const lower = key.toLowerCase();
    result[lower] = isSensitiveHeaderName(key)
      ? sha256Hex(normalized)
      : normalized;
  }
  return Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function normalizeQueryForKey(
  query?: HttpRequest['query'],
): Record<string, unknown> {
  if (!query) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(query)
      .filter(([, value]) => value != null)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
