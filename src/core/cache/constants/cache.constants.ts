import { CacheStorage } from '../enums/cache-storage.enum';
import { CacheModuleOptions } from '../types/cache.types';

export const CACHE_OPTIONS = Symbol('CACHE_OPTIONS');
export const CACHE_BACKEND = Symbol('CACHE_BACKEND');
export const CACHE_LOADER_LOCK = Symbol('CACHE_LOADER_LOCK');

/** Loader lock keys — separate from data keys under `cache:`. */
export const CACHE_LOADER_LOCK_PREFIX = 'cache:lock:';

/** Default Redis / logical key prefix — must not collide with `rl:` or `revoked_jti:`. */
export const DEFAULT_CACHE_KEY_PREFIX = 'cache:';

export const DEFAULT_CACHE_OPTIONS: CacheModuleOptions = {
  storage: CacheStorage.Memory,
  keyPrefix: DEFAULT_CACHE_KEY_PREFIX,
};
