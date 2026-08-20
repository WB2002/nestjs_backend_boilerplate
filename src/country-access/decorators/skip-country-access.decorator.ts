import { SetMetadata } from '@nestjs/common';
import { SKIP_COUNTRY_ACCESS_KEY } from '../constants';

export const SkipCountryAccess = () =>
  SetMetadata(SKIP_COUNTRY_ACCESS_KEY, true);
