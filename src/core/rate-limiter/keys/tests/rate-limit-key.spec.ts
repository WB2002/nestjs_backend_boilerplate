import { RateLimitIdentifier } from '../../enums/rate-limit-identifier.enum';
import { RateLimitStorage } from '../../enums/rate-limit-storage.enum';
import { buildRateLimitKey } from '../rate-limit-key';

describe('buildRateLimitKey', () => {
  it('includes scope', () => {
    const key = buildRateLimitKey({
      policy: 'global-ip',
      identifier: RateLimitIdentifier.Ip,
      tracker: '1.1.1.1',
      routeScope: 'app',
      storage: RateLimitStorage.Memory,
      hashRouteScope: false,
    });
    expect(key).toBe('rl:global-ip:Ip:1.1.1.1:app');
  });
});
