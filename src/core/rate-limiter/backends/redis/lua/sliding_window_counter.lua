-- KEYS[1] = key
-- ARGV: nowMs, limit, durationMs, cost
local key = KEYS[1]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local duration = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'start', 'prev', 'curr')
local start = tonumber(data[1])
local prev = tonumber(data[2]) or 0
local curr = tonumber(data[3]) or 0

if start == nil then
  start = now
  prev = 0
  curr = 0
end

while now >= start + duration do
  prev = curr
  curr = 0
  start = start + duration
  if now >= start + duration * 2 then
    prev = 0
    curr = 0
    start = now
    break
  end
end

local elapsed = now - start
local weight = 1 - (elapsed / duration)
local estimate = prev * weight + curr
local reset = math.max(0, start + duration - now)

if estimate + cost > limit then
  redis.call('HSET', key, 'start', start, 'prev', prev, 'curr', curr)
  redis.call('PEXPIRE', key, duration * 2)
  return {0, math.max(0, math.floor(limit - estimate)), reset, reset}
end

curr = curr + cost
estimate = prev * weight + curr
redis.call('HSET', key, 'start', start, 'prev', prev, 'curr', curr)
redis.call('PEXPIRE', key, duration * 2)
return {1, math.max(0, math.floor(limit - estimate)), reset, 0}
