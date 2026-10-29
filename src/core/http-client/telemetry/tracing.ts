import {
  context,
  propagation,
  Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { getAwsXrayPropagator } from '@/core/telemetry/xray-propagation';
import type { ClientIdentity, HttpRequest, HttpResponse } from '../types';
import { redactOtelAttributes } from '@/core/redaction/redact-otel-attributes';

const tracer = trace.getTracer('core.http-client');

export interface TraceHandles {
  span?: Span;
  endSuccess(response: HttpResponse): void;
  endError(error: unknown): void;
  injectHeaders(headers: Record<string, string>): Record<string, string>;
}

export function startLogicalTrace(
  identity: ClientIdentity,
  request: HttpRequest,
  isTracingEnabled: boolean,
): TraceHandles | undefined {
  if (!isTracingEnabled) {
    return undefined;
  }

  const span = tracer.startSpan(`HTTP ${request.method}`, {
    kind: SpanKind.CLIENT,
    attributes: redactOtelAttributes({
      'http.method': request.method,
      'http.url': request.url,
      'peer.service': identity.serviceName,
      'http.client.kind': identity.kind,
    }),
  });

  return createTraceHandles(span, true);
}

export function startAttemptTrace(
  identity: ClientIdentity,
  request: HttpRequest,
  attempt: number,
  isTracingEnabled: boolean,
  parent?: TraceHandles,
): TraceHandles | undefined {
  if (!isTracingEnabled) {
    return undefined;
  }

  const parentCtx = parent?.span
    ? trace.setSpan(context.active(), parent.span)
    : context.active();

  const span = tracer.startSpan(
    `HTTP ${request.method} attempt`,
    {
      kind: SpanKind.CLIENT,
      attributes: redactOtelAttributes({
        'http.method': request.method,
        'http.url': request.url,
        'peer.service': identity.serviceName,
        'http.client.kind': identity.kind,
        'http.request.attempt': attempt,
        'http.request.headers': JSON.stringify(request.headers ?? {}),
      }),
    },
    parentCtx,
  );

  // Attempt spans do not inject; logical span owns propagation headers.
  return createTraceHandles(span, false);
}

function createTraceHandles(
  span: Span,
  shouldInjectTraceContext: boolean,
): TraceHandles {
  return {
    span,
    endSuccess(response: HttpResponse) {
      span.setAttribute('http.status_code', response.status);
      span.setStatus({
        code: response.ok ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      });
      span.end();
    },
    endError(error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      span.recordException(error instanceof Error ? error : new Error(message));
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.end();
    },
    injectHeaders(headers: Record<string, string>) {
      if (!shouldInjectTraceContext) {
        return headers;
      }
      const carrier: Record<string, string> = { ...headers };
      const ctx = trace.setSpan(context.active(), span);
      propagation.inject(ctx, carrier);
      getAwsXrayPropagator().inject(ctx, carrier, {
        set(carrierObj, key, value) {
          Object.assign(carrierObj, { [key]: value });
        },
      });
      return carrier;
    },
  };
}
