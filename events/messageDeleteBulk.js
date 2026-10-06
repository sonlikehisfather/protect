'use strict';

const embed        = require('../utils/embed');
const logger       = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');

module.exports = {
  name : 'messageDeleteBulk',
  once : false,

  async execute(client, messages, channel) {
    try {
      const guild = channel.guild;
      if (!guild) return;

      if (logger.isIgnored(guild.id, channel.id)) return;

      const count = messages.size;

      const authors = [...new Set(messages.map(m => m.author?.id).filter(Boolean))].slice(0, 6);
      const authorList = authors.length ? authors.map(a => `<@${a}>`).join(' ') : 'N/A';

      const fields = [
        { name: 'Salon', value: `<#${channel.id}>`, inline: true },
        { name: 'Total', value: String(count), inline: true },
        { name: 'Auteurs (ex.)', value: authorList, inline: false },
      ];

      const e = embed.log(guild.id, 'Suppression en masse', fields, {
        color: '#ED4245',
        timestamp: true,
      });

      await logger.send(client, guild.id, 'messagelog', e, { sourceChannelId: channel.id });
    } catch (err) {
      errorHandler.handle(err, {
        source : 'messageDeleteBulk',
        guildId: channel.guild?.id,
      });
    }
  },
};
