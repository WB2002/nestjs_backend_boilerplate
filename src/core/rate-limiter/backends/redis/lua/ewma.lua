-- KEYS[1] = key
-- ARGV: nowMs, limit, durationMs, cost
local key = KEYS[1]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local duration = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'ewma', 'last')
local ewma = tonumber(data[1])
local last = tonumber(data[2])
if ewma == nil then
  ewma = 0
  last = now
end

local dt = math.max(0, now - last)
local decay = math.exp(-dt / duration)
local projected = ewma * decay + cost

if projected > limit then
  local retry = duration
  if ewma > 0 and cost <= limit then
    local target = (limit - cost) / ewma
    if target > 0 then
      retry = math.ceil(-duration * math.log(target))
    end
  end
  redis.call('HSET', key, 'ewma', ewma, 'last', now)
  redis.call('PEXPIRE', key, duration * 2)
  return {0, math.max(0, math.floor(limit - ewma * decay)), retry, retry}
end

ewma = projected
redis.call('HSET', key, 'ewma', ewma, 'last', now)
redis.call('PEXPIRE', key, duration * 2)
return {1, math.max(0, math.floor(limit - ewma)), duration, 0}
