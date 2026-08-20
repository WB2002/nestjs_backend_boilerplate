-- Atomic create/update/delete for feature flags with optimistic concurrency.
-- KEYS[1] = flag key (feature_flags:{env}:{flagKey})
-- KEYS[2] = index key (feature_flags:index:{env})
-- KEYS[3] = pub/sub channel
-- ARGV[1] = operation: "create" | "update" | "delete"
-- ARGV[2] = expectedVersion (number as string; for create use "0")
-- ARGV[3] = event JSON (environment/key/event; version filled in by script)
-- ARGV[4] = flag JSON without final version (create/update only; empty for delete)
--
-- Returns:
--   { "ok", version, flagJsonOrEmpty }
--   { "conflict", currentVersion, currentJsonOrEmpty }
--   { "not_found", "0", "" }

local flagKey = KEYS[1]
local indexKey = KEYS[2]
local channel = KEYS[3]
local op = ARGV[1]
local expectedVersion = tonumber(ARGV[2])
local eventTemplate = ARGV[3]
local flagJson = ARGV[4]

local current = redis.call('GET', flagKey)

if op == 'create' then
  if current then
    local cur = cjson.decode(current)
    return { 'conflict', tostring(cur.version), current }
  end
  if expectedVersion ~= 0 then
    return { 'conflict', '0', '' }
  end
  local flag = cjson.decode(flagJson)
  flag.version = 1
  local encoded = cjson.encode(flag)
  redis.call('SET', flagKey, encoded)
  redis.call('SADD', indexKey, flag.key)
  local event = cjson.decode(eventTemplate)
  event.version = 1
  event.event = 'FLAG_UPDATED'
  redis.call('PUBLISH', channel, cjson.encode(event))
  return { 'ok', '1', encoded }
end

if not current then
  return { 'not_found', '0', '' }
end

local cur = cjson.decode(current)
if cur.version ~= expectedVersion then
  return { 'conflict', tostring(cur.version), current }
end

if op == 'delete' then
  local newVersion = cur.version + 1
  redis.call('DEL', flagKey)
  redis.call('SREM', indexKey, cur.key)
  local event = cjson.decode(eventTemplate)
  event.version = newVersion
  event.event = 'FLAG_DELETED'
  redis.call('PUBLISH', channel, cjson.encode(event))
  return { 'ok', tostring(newVersion), '' }
end

if op == 'update' then
  local flag = cjson.decode(flagJson)
  flag.version = cur.version + 1
  flag.createdAt = cur.createdAt
  local encoded = cjson.encode(flag)
  redis.call('SET', flagKey, encoded)
  redis.call('SADD', indexKey, flag.key)
  local event = cjson.decode(eventTemplate)
  event.version = flag.version
  event.event = 'FLAG_UPDATED'
  redis.call('PUBLISH', channel, cjson.encode(event))
  return { 'ok', tostring(flag.version), encoded }
end

return { 'not_found', '0', '' }
