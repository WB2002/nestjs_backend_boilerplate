-- KEYS[1] = key (sorted set: member = unique id, score = timestamp)
-- ARGV: nowMs, limit, durationMs, cost, member
local key = KEYS[1]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local duration = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local member = ARGV[5]
local cutoff = now - duration

redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)

local entries = redis.call('ZRANGE', key, 0, -1, 'WITHSCORES')
local used = 0
-- members encoded as cost:uuid — sum costs
for i = 1, #entries, 2 do
  local m = entries[i]
  local c = tonumber(string.match(m, '^(%d+):')) or 1
  used = used + c
end

if used + cost > limit then
  local oldestScore = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = duration
  if #oldestScore >= 2 then
    retry = math.max(0, tonumber(oldestScore[2]) + duration - now)
  end
  redis.call('PEXPIRE', key, duration * 2)
  return {0, math.max(0, limit - used), retry, retry}
end

redis.call('ZADD', key, now, cost .. ':' .. member)
redis.call('PEXPIRE', key, duration * 2)
local newUsed = used + cost
local oldestScore = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local reset = duration
if #oldestScore >= 2 then
  reset = math.max(0, tonumber(oldestScore[2]) + duration - now)
end
return {1, math.max(0, limit - newUsed), reset, 0}
