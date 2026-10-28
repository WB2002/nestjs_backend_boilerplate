import { SetMetadata } from '@nestjs/common';

export const SKIP_TRACING_KEY = 'skipTracing';

export function SkipTracing(): ClassDecorator & MethodDecorator {
  return SetMetadata(SKIP_TRACING_KEY, true);
}
