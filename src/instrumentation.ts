import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { AWSXRayIdGenerator } from '@opentelemetry/id-generator-aws-xray';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { parseLogRedactionConfig } from './core/redaction/parse-log-redaction-config';
import { parseTelemetryConfig } from './core/telemetry/parse-telemetry-config';
import { isTraceExemptPath } from './core/telemetry/is-trace-exempt-path';
import { createRedactingSpanExporter } from './core/telemetry/redacting-span-exporter';

let sdk: NodeSDK | undefined;

/** Used by Http instrumentation — no X-Ray segments for ALB probes. */
export function shouldIgnoreIncomingTraceForUrl(url: string): boolean {
  return isTraceExemptPath(url);
}

export async function registerInstrumentation(): Promise<void> {
  const config = parseTelemetryConfig();
  if (!config.otelEnabled) {
    return;
  }

  if (sdk) {
    return;
  }

  const sdkOptions: ConstructorParameters<typeof NodeSDK>[0] = {
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
    }),
    idGenerator: new AWSXRayIdGenerator(),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) =>
          shouldIgnoreIncomingTraceForUrl(req.url ?? ''),
        ignoreOutgoingRequestHook: (req) => {
          const path = req.path ?? '';
          return path !== '' && shouldIgnoreIncomingTraceForUrl(path);
        },
      }),
    ],
  };

  if (config.otlpEndpoint) {
    const baseExporter = new OTLPTraceExporter({
      url: `${config.otlpEndpoint}/v1/traces`,
    });
    const redaction = parseLogRedactionConfig(process.env);
    sdkOptions.traceExporter = createRedactingSpanExporter(baseExporter, {
      enabled: redaction.enabled,
    });
  }

  sdk = new NodeSDK(sdkOptions);

  await sdk.start();
}

const isLoadedAsPreload = require.main !== module;
if (isLoadedAsPreload) {
  void registerInstrumentation();
}
