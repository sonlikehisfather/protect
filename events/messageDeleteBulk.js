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

      const e = embed.build(guild.id, null, {
        title       : 'Suppression en masse',
        description : `**${count}** messages supprimés dans <#${channel.id}>`,
        color       : '#ED4245',
        timestamp   : new Date(),
      });

      await logger.send(client, guild.id, 'messagelog', e, {
        sourceChannelId: channel.id,
      });
    } catch (err) {
      errorHandler.handle(err, {
        source : 'messageDeleteBulk',
        guildId: channel.guild?.id,
      });
    }
  },
};
