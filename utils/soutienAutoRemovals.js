'use strict';


const TTL_MS = 10_000;

const _pending = new Map();

function _key(guildId, userId, roleId) {
  return `${guildId}:${userId}:${roleId}`;
}

module.exports = {
  mark(guildId, userId, roleId) {
    const k = _key(guildId, userId, roleId);
    clearTimeout(_pending.get(k)?.timer);
    const timer = setTimeout(() => _pending.delete(k), TTL_MS);
    _pending.set(k, { timer });
  },

  has(guildId, userId, roleId) {
    return _pending.has(_key(guildId, userId, roleId));
  },

  consume(guildId, userId, roleId) {
    const k = _key(guildId, userId, roleId);
    const entry = _pending.get(k);
    if (!entry) return false;
    clearTimeout(entry.timer);
    _pending.delete(k);
    return true;
  },
};
