'use strict';

const _cache = new Map();

function _getGuildCache(guildId) {
  if (!_cache.has(guildId)) _cache.set(guildId, new Map());
  return _cache.get(guildId);
}

function cacheInvite(guildId, invite) {
  const gc = _getGuildCache(guildId);
  gc.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null });
}

function removeInvite(guildId, code) {
  _getGuildCache(guildId).delete(code);
}

async function loadGuild(guild) {
  try {
    const invites = await guild.invites.fetch();
    const gc = _getGuildCache(guild.id);
    gc.clear();
    for (const [code, invite] of invites) {
      gc.set(code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null });
    }
  } catch {}
}

async function findInviter(client, guild) {
  try {
    const before = _getGuildCache(guild.id);
    const after  = await guild.invites.fetch();

    let inviterId = null;

    for (const [code, invite] of after) {
      const cached = before.get(code);
      const uses   = invite.uses ?? 0;

      if (cached && uses > cached.uses) {
        inviterId = invite.inviter?.id ?? cached.inviterId ?? null;
        before.set(code, { uses, inviterId: invite.inviter?.id ?? cached.inviterId ?? null });
        break;
      }

      if (!cached) {
        before.set(code, { uses, inviterId: invite.inviter?.id ?? null });
      }
    }

    return inviterId;
  } catch {
    return null;
  }
}

module.exports = { cacheInvite, removeInvite, loadGuild, findInviter };
