import { DynamicModule, Global, Module } from '@nestjs/common';
import {
  INBOUND_BULKHEAD_OPTIONS,
  INBOUND_LOAD_LEVEL_OPTIONS,
  PRIORITY_SHEDDING_OPTIONS,
} from './overload.constants';
import { parseInboundLoadLevelConfig } from './load-level/parse-inbound-load-level-config';
import { InboundBulkheadMiddleware } from './inbound-bulkhead.middleware';
import { InboundBulkheadService } from './inbound-bulkhead.service';
import { InboundPriorityBulkheadGuard } from './guards/inbound-priority-bulkhead.guard';
import { parseInboundBulkheadConfig } from './parse-inbound-bulkhead-config';
import { parsePrioritySheddingConfig } from './priority/parse-priority-shedding-config';
import { InboundBulkheadConfig } from './inbound-bulkhead.types';

@Global()
@Module({})
export class OverloadModule {
  static forRoot(config?: InboundBulkheadConfig): DynamicModule {
    const resolved = config ?? parseInboundBulkheadConfig();
    const shedding = parsePrioritySheddingConfig();
    const loadLevel = parseInboundLoadLevelConfig();
    return {
      module: OverloadModule,
      providers: [
        {
          provide: INBOUND_BULKHEAD_OPTIONS,
          useValue: resolved,
        },
        {
          provide: INBOUND_LOAD_LEVEL_OPTIONS,
          useValue: loadLevel,
        },
        {
          provide: PRIORITY_SHEDDING_OPTIONS,
          useValue: shedding,
        },
        InboundBulkheadService,
        InboundBulkheadMiddleware,
        InboundPriorityBulkheadGuard,
      ],
      exports: [
        INBOUND_BULKHEAD_OPTIONS,
        INBOUND_LOAD_LEVEL_OPTIONS,
        PRIORITY_SHEDDING_OPTIONS,
        InboundBulkheadService,
        InboundBulkheadMiddleware,
        InboundPriorityBulkheadGuard,
      ],
    };
  }
}
