'use strict';

/** Jest shim: @nestjs/bullmq is ESM-only; avoid VM loader issues in unit tests. */

function paramDecorator() {
  return () => undefined;
}

class WorkerHost {}

const BullModule = {
  forRoot: () => ({ module: class BullRootModule {} }),
  forRootAsync: () => ({ module: class BullRootAsyncModule {} }),
  registerQueue: () => ({ module: class BullQueueModule {} }),
  registerQueueAsync: () => ({ module: class BullQueueAsyncModule {} }),
};

module.exports = {
  InjectQueue: paramDecorator,
  Processor: paramDecorator,
  WorkerHost,
  BullModule,
};
