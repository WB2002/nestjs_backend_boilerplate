import { SetMetadata } from '@nestjs/common';
import { SKIP_INBOUND_BULKHEAD_KEY } from '../overload.constants';

/** Documents probe/opt-out routes; health paths are exempt in middleware via {@link isPressureExemptPath}. */
export const SkipInboundBulkhead = () =>
  SetMetadata(SKIP_INBOUND_BULKHEAD_KEY, true);
