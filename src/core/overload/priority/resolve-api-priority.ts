import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { API_PRIORITY_KEY } from '../overload.constants';
import { ApiPriorityLevel } from './api-priority-level.enum';
import { PrioritySheddingConfig } from './priority-shedding.types';

export function resolveApiPriority(
  reflector: Reflector,
  context: ExecutionContext,
  config: PrioritySheddingConfig,
): ApiPriorityLevel {
  const fromHandler = reflector.getAllAndOverride<ApiPriorityLevel | undefined>(
    API_PRIORITY_KEY,
    [context.getHandler(), context.getClass()],
  );
  return fromHandler ?? config.defaultPriority;
}
