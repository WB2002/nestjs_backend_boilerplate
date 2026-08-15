/** Redis Lua script identifiers (filenames without .lua). */
export type RedisLuaScriptName =
  | 'token_bucket'
  | 'leaky_bucket'
  | 'fixed_window'
  | 'sliding_window_log'
  | 'sliding_window_counter'
  | 'ewma';
