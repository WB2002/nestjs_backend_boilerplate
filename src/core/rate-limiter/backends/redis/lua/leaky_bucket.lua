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

local data = redis.call('HMGET', key, 'level', 'last')
local level = tonumber(data[1])
local last = tonumber(data[2])
if level == nil then
  level = 0
  last = now
end

local leak = limit / duration
local elapsed = math.max(0, now - last)
level = math.max(0, level - elapsed * leak)

if level + cost > capacity then
  local overflow = level + cost - capacity
  local retry = 0
  local reset = 0
  if leak > 0 then
    retry = math.ceil(overflow / leak)
    reset = math.ceil(level / leak)
  else
    retry = duration
    reset = duration
  end
  redis.call('HSET', key, 'level', level, 'last', now)
  redis.call('PEXPIRE', key, duration * 2)
  return {0, math.max(0, math.floor(capacity - level)), reset, retry}
end

level = level + cost
local reset = 0
if leak > 0 then
  reset = math.ceil(level / leak)
else
  reset = duration
end
redis.call('HSET', key, 'level', level, 'last', now)
redis.call('PEXPIRE', key, duration * 2)
return {1, math.max(0, math.floor(capacity - level)), reset, 0}
