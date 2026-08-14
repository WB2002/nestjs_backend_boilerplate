-- KEYS[1] = key
-- ARGV: nowMs, limit, durationMs, cost
local key = KEYS[1]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local duration = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'start', 'count')
local start = tonumber(data[1])
local count = tonumber(data[2])

if start == nil or now >= start + duration then
  start = now
  count = 0
end

local reset = math.max(0, start + duration - now)

if count + cost > limit then
  redis.call('HSET', key, 'start', start, 'count', count)
  redis.call('PEXPIRE', key, duration * 2)
  return {0, math.max(0, limit - count), reset, reset}
end

count = count + cost
redis.call('HSET', key, 'start', start, 'count', count)
redis.call('PEXPIRE', key, duration * 2)
return {1, math.max(0, limit - count), reset, 0}
