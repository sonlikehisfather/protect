'use strict';

const logger = require('../utils/logger');
const embed = require('../utils/embed');

module.exports = {
  name: 'channelUpdate',
  once: false,

  async execute(client, oldChannel, newChannel) {
    try {
      if (!newChannel.guild) return;

      const guildId = newChannel.guild.id;

      if (oldChannel.name !== newChannel.name) {
        await logger.send(
          client,
          guildId,
          'channellog',
          embed.build(guildId, null, {
            title       : 'Salon renommé',
            description : `Ancien: **${oldChannel.name}**\nNouveau: **${newChannel.name}**\n<#${newChannel.id}>`,
            color       : '#FEE75C',
            timestamp   : true,
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
