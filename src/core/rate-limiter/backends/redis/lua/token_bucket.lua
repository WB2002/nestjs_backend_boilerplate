-- KEYS[1] = key
-- ARGV: nowMs, limit, durationMs, cost, burst
local key = KEYS[1]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local duration = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local burst = tonumber(ARGV[5])
local capacity = burst
if capacity <= 0 then capacity = limit end

local data = redis.call('HMGET', key, 'tokens', 'last')
local tokens = tonumber(data[1])
local last = tonumber(data[2])
if tokens == nil then
  tokens = capacity
  last = now
end

local refill = limit / duration
local elapsed = math.max(0, now - last)
tokens = math.min(capacity, tokens + elapsed * refill)

if tokens < cost then
  local deficit = cost - tokens
  local retry = 0
  local reset = 0
  if refill > 0 then
    retry = math.ceil(deficit / refill)
    reset = math.ceil((capacity - tokens) / refill)
  else
    retry = duration
    reset = duration
  end
  redis.call('HSET', key, 'tokens', tokens, 'last', now)
  redis.call('PEXPIRE', key, duration * 2)
  return {0, math.floor(tokens), reset, retry}
end

tokens = tokens - cost
local reset = 0
if refill > 0 then
  reset = math.ceil((capacity - tokens) / refill)
else
  reset = duration
end
redis.call('HSET', key, 'tokens', tokens, 'last', now)
redis.call('PEXPIRE', key, duration * 2)
return {1, math.floor(tokens), reset, 0}
