import { AWSXRayPropagator } from '@opentelemetry/propagator-aws-xray';

let propagator: AWSXRayPropagator | undefined;

export function getAwsXrayPropagator(): AWSXRayPropagator {
  if (!propagator) {
    propagator = new AWSXRayPropagator();
  }
  return propagator;
}
