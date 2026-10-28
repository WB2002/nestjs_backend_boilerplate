import { SetMetadata } from '@nestjs/common';
import { ApiPriorityLevel } from '../priority/api-priority-level.enum';
import { API_PRIORITY_KEY } from '../overload.constants';

export const ApiPriority = (level: ApiPriorityLevel) =>
  SetMetadata(API_PRIORITY_KEY, level);
