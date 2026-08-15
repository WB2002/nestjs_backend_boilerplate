import { SetMetadata } from '@nestjs/common';
import { SKIP_REQUEST_DEADLINE_KEY } from '../constants/request-deadline.constants';

export const SkipRequestDeadline = () =>
  SetMetadata(SKIP_REQUEST_DEADLINE_KEY, true);
