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

      const lines = [];
      lines.push(`Message \u00e9dit\u00e9 dans ${channelRef}` + (jumpUrl ? ` [*(aller au message)*](${jumpUrl})` : ''));
      lines.push('');
      lines.push('**Avant**');
      lines.push(before);
      lines.push('');
      lines.push('**Apr\u00e8s**');
      lines.push(after);

      const now = new Date();
      const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

      const e = embed.build(guildId, lines.join('\n'), {
        authorName: newMessage.author.tag,
        authorIcon: newMessage.author.displayAvatarURL({ size: 64 }),
        footer    : `Aujourd'hui \u00e0 ${timeStr}`,
        timestamp : false,
      });

      await logger.send(client, guildId, 'messagelog', e, {
        sourceChannelId: channelId,
      });

    } catch (err) {
      errorHandler.handle(err, {
        source : 'messageUpdate',
        guildId,
      });
    }
  },
};
