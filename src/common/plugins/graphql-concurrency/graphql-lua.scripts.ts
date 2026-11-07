export const GQL_ACQUIRE_CONCURRENCY_LUA = `
local c = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
if c > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return {0, c - 1}
end
return {1, c}
`.trim();

export const GQL_CONSUME_BUDGET_LUA = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used + tonumber(ARGV[1]) > tonumber(ARGV[2]) then
  return {0, used}
end
local n = redis.call('INCRBY', KEYS[1], ARGV[1])
if n == tonumber(ARGV[1]) then
  redis.call('EXPIRE', KEYS[1], ARGV[3])
end
return {1, n}
`.trim();
