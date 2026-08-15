import { SetMetadata } from '@nestjs/common';
import { REQUEST_TIMEOUT_KEY } from '../constants/request-deadline.constants';

export const RequestTimeout = (ms: number) =>
  SetMetadata(REQUEST_TIMEOUT_KEY, ms);
