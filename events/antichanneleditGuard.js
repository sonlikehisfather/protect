'use strict';

const { AuditLogEvent } = require('discord.js');
const errorHandler = require('../utils/errorHandler');
const { countGuard } = require('../utils/antiraidModules');
const core = require('../utils/antiraidCore');

function _overwritesOf(channel) {
  return [...(channel.permissionOverwrites?.cache?.values() ?? [])].map(o => ({
    id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield,
  }));
}

function _overwritesChanged(oldCh, newCh) {
  const a = _overwritesOf(oldCh);
  const b = _overwritesOf(newCh);
  if (a.length !== b.length) return true;
  const map = new Map(a.map(o => [o.id, o]));
  return b.some(o => {
    const prev = map.get(o.id);
    return !prev || prev.allow !== o.allow || prev.deny !== o.deny;
  });
}

module.exports = {
  name : 'channelUpdate',
  once : false,

  async execute(client, oldChannel, newChannel) {
    const guild = newChannel.guild;
    if (!guild) return;

    // Le traitement (audit log + sanction) tourne en arrière-plan : il ne retarde pas les autres handlers.
    _handle(client, guild, oldChannel, newChannel).catch(err =>
      errorHandler.handle(err, { source: 'antichanneleditGuard', guildId: guild.id })
    );
  },
};

async function _handle(client, guild, oldChannel, newChannel) {
  if (!core.isEnabled(guild.id, 'antichanneleditEnabled')) return;

  const permsChanged = _overwritesChanged(oldChannel, newChannel);
  const nameChanged  = oldChannel.name !== newChannel.name;
  if (!permsChanged && !nameChanged) return;

  const result = await countGuard(client, guild, {
    prefix    : 'antichanneledit',
    auditType : permsChanged ? AuditLogEvent.ChannelOverwriteUpdate : AuditLogEvent.ChannelUpdate,
    targetId  : newChannel.id,
    item      : {
      channelId  : newChannel.id,
      name       : oldChannel.name,
      overwrites : permsChanged ? _overwritesOf(oldChannel) : null,
    },
    label     : 'Antichanneledit déclenché',
    detail    : `Salon : ${newChannel.name} (${newChannel.id})${permsChanged ? ' - permissions modifiées' : ''}${nameChanged ? ` - renommé (ancien : ${oldChannel.name})` : ''}`,
  });

  if (!result?.cfg.antichanneleditRestore) return;

  // On remet l'état d'origine de chaque salon touché pendant la rafale (le plus ancien instantané gagne).
  const seen = new Set();
  for (const snap of result.items) {
    if (!snap || seen.has(snap.channelId)) continue;
    seen.add(snap.channelId);

    const channel = guild.channels.cache.get(snap.channelId);
    if (!channel) continue;

    if (snap.overwrites) {
      await channel.permissionOverwrites
        .set(snap.overwrites, 'Antiraid - antichanneledit restauration')
        .catch(() => {});
    }
    if (snap.name && channel.name !== snap.name) {
      await channel.setName(snap.name, 'Antiraid - antichanneledit restauration').catch(() => {});
    }
    core.record(guild.id, 'restore', 'antichanneledit', result.entry.executor.id, `salon restauré : ${snap.name}`);
  }
}
