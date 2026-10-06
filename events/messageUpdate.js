'use strict';


const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');

module.exports = {
  name : 'messageUpdate',
  once : false,

  async execute(client, oldMessage, newMessage) {
    if (!newMessage.guild) return;
    if (newMessage.author?.bot) return;

    if (newMessage.partial || oldMessage.partial) return;

    if (oldMessage.content === newMessage.content) return;

    const guildId   = newMessage.guild.id;
    const channelId = newMessage.channel.id;

    try {
      if (logger.isIgnored(guildId, channelId)) return;

      const before = oldMessage.content?.slice(0, 900) || '*(non disponible)*';
      const after  = newMessage.content.slice(0, 900);

      const channelRef = newMessage.channel
        ? `<#${newMessage.channel.id}>`
        : '#Aucun acc\u00e8s';

      const jumpUrl = newMessage.url ?? '';

      const beforeVal = before || '*(non disponible)*';
      const afterVal = after || '*(non disponible)*';

      const fields = [
        { name: 'Auteur', value: `${newMessage.author.tag} (<@${newMessage.author.id}>) \`${newMessage.author.id}\``, inline: false },
        { name: 'Salon', value: channelRef, inline: true },
        { name: 'Message', value: `\`${newMessage.id}\`` , inline: true },
        { name: 'Avant', value: beforeVal, inline: false },
        { name: 'Après', value: afterVal, inline: false },
      ];

      const e = embed.log(guildId, 'Message édité', fields, {
        thumbnail: newMessage.author.displayAvatarURL({ size: 64 }),
        timestamp: true,
      });

      await logger.send(client, guildId, 'messagelog', e, { sourceChannelId: channelId });

    } catch (err) {
      errorHandler.handle(err, {
        source : 'messageUpdate',
        guildId,
      });
    }
  },
};
