import { DynamicModule, Global, Module } from '@nestjs/common';
import { INBOUND_BULKHEAD_OPTIONS } from './overload.constants';
import { InboundBulkheadMiddleware } from './inbound-bulkhead.middleware';
import { InboundBulkheadService } from './inbound-bulkhead.service';
import { parseInboundBulkheadConfig } from './parse-inbound-bulkhead-config';
import { InboundBulkheadConfig } from './inbound-bulkhead.types';

@Global()
@Module({})
export class OverloadModule {
  static forRoot(config?: InboundBulkheadConfig): DynamicModule {
    const resolved = config ?? parseInboundBulkheadConfig();
    return {
      module: OverloadModule,
      providers: [
        {
          provide: INBOUND_BULKHEAD_OPTIONS,
          useValue: resolved,
        },
        InboundBulkheadService,
        InboundBulkheadMiddleware,
      ],
      exports: [InboundBulkheadService, InboundBulkheadMiddleware],
    };
  }
}
