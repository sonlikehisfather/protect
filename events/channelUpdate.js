'use strict';

const { AuditLogEvent, PermissionFlagsBits } = require('discord.js');

const logger = require('../utils/logger');
const embed = require('../utils/embed');
const db = require('../core/database');
const angelActions = require('../utils/angelActions');

const pendingAngelOverwriteRestores = new Map();

module.exports = {
  name: 'channelUpdate',
  once: false,

  async execute(client, oldChannel, newChannel) {
    try {
      if (!newChannel.guild) return;

      const guildId = newChannel.guild.id;
      await _restoreAngelOverwrites(oldChannel, newChannel);

      if (oldChannel.name !== newChannel.name) {
        await logger.send(
          client,
          guildId,
          'channellog',
          embed.log(guildId, 'Salon renommé', [
            {
              name   : 'Salon',
              value  : `<#${newChannel.id}>`,
              inline : false,
            },
            {
              name   : 'Ancien nom',
              value  : `**${oldChannel.name}**`,
              inline : true,
            },
            {
              name   : 'Nouveau nom',
              value  : `**${newChannel.name}**`,
              inline : true,
            },
          ], {
            color     : '#FEE75C',
            timestamp : true,
          })
        );
      }

      const oldPerms = oldChannel.permissionOverwrites?.cache;
      const newPerms = newChannel.permissionOverwrites?.cache;

      if (oldPerms && newPerms) {
        const changes = [];

        for (const [id, newOverwrite] of newPerms) {
          const oldOverwrite = oldPerms.get(id);
          if (!oldOverwrite) {
            changes.push(`Permission ajoutée pour <@${newOverwrite.type === 0 ? '&' : ''}${id}>`);
          } else if (
            oldOverwrite.allow.bitfield !== newOverwrite.allow.bitfield ||
            oldOverwrite.deny.bitfield !== newOverwrite.deny.bitfield
          ) {
            changes.push(`Permission modifiée pour <@${newOverwrite.type === 0 ? '&' : ''}${id}>`);
          }
        }

        for (const [id] of oldPerms) {
          if (!newPerms.has(id)) {
            const old = oldPerms.get(id);
            changes.push(`Permission retirée pour <@${old.type === 0 ? '&' : ''}${id}>`);
          }
        }

        if (changes.length > 0) {
          await logger.send(
            client,
            guildId,
            'channellog',
            embed.build(guildId, null, {
              title       : 'Permissions modifiées',
              description : `<#${newChannel.id}>\n${changes.slice(0, 10).join('\n')}`,
              color       : '#FEE75C',
              timestamp   : true,
            })
          );
        }
      }
    } catch {}
  },
};

async function _restoreAngelOverwrites(oldChannel, newChannel) {
  const guild = newChannel.guild;
  const oldPerms = oldChannel.permissionOverwrites?.cache;
  const newPerms = newChannel.permissionOverwrites?.cache;
  if (!oldPerms || !newPerms) return;

  const targetIds = new Set([
    ...oldPerms.filter(overwrite => overwrite.type === 1).keys(),
    ...newPerms.filter(overwrite => overwrite.type === 1).keys(),
  ]);

  for (const userId of targetIds) {
    if (!db.isAngelUser(guild.id, userId)) continue;

    const oldOverwrite = oldPerms.get(userId);
    const newOverwrite = newPerms.get(userId);
    const muteFlags = [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.Speak,
    ];
    const muteRestrictionAdded = muteFlags.some(flag =>
      newOverwrite?.deny.has(flag) && !oldOverwrite?.deny.has(flag)
    );
    if (!muteRestrictionAdded) continue;

    const expected = oldOverwrite ? _overwriteFingerprint(oldOverwrite) : null;
    const key = `${guild.id}:${newChannel.id}:${userId}`;
    const pending = pendingAngelOverwriteRestores.get(key);

    if (pending === _overwriteFingerprint(newOverwrite)) {
      pendingAngelOverwriteRestores.delete(key);
      continue;
    }

    if (_overwriteFingerprint(oldOverwrite) === _overwriteFingerprint(newOverwrite)) continue;

    pendingAngelOverwriteRestores.set(key, expected);
    setTimeout(() => {
      if (pendingAngelOverwriteRestores.get(key) === expected) pendingAngelOverwriteRestores.delete(key);
    }, 10_000).unref?.();

    let restored = false;
    if (!oldOverwrite) {
      restored = await newChannel.permissionOverwrites.delete(userId, 'Angel protection: channel mute reverted')
        .then(() => true).catch(() => false);
    } else {
      const permissions = Object.fromEntries(
        Object.entries(PermissionFlagsBits)
          .filter(([, flag]) => typeof flag === 'bigint')
          .map(([name, flag]) => [
            name,
            oldOverwrite.allow.has(flag) ? true : oldOverwrite.deny.has(flag) ? false : null,
          ])
      );
      restored = await newChannel.permissionOverwrites.edit(
        userId,
        permissions,
        'Angel protection: channel mute reverted'
      ).then(() => true).catch(() => false);
    }

    const executor = await angelActions.findRecentExecutor(
      guild,
      newChannel.id,
      AuditLogEvent.ChannelOverwriteUpdate
    );
    await angelActions.notify(
      guild,
      `<@${userId}> est un ange. Mute/permissions de salon ${restored ? 'annulé' : 'non restauré'}${executor ? ` (tenté par <@${executor.id}>)` : ''}.`,
      newChannel,
    );
  }
}

function _overwriteFingerprint(overwrite) {
  return overwrite ? `${overwrite.allow.bitfield}:${overwrite.deny.bitfield}` : null;
}
